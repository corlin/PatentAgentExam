import { Hono } from 'hono'
import { Subject, Chapter, KnowledgePoint } from '../../../../packages/shared/src/types/exam'

export type Bindings = {
  DB: D1Database;
  VECTORIZE_INDEX: VectorizeIndex;
  AI: any;
};

const rag = new Hono<{ Bindings: Bindings }>()

// 工具方法：分批处理
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// 内部接口：根据现有大纲构建向量索引
rag.post('/embed-syllabus', async (c) => {
  try {
    const { results: kps } = await c.env.DB.prepare(
      'SELECT * FROM knowledge_points'
    ).all<KnowledgePoint>()

    const aiModel = '@cf/baai/bge-m3';
    let embeddedCount = 0;

    // 为了避免请求体过大或超时，我们分批（例如每批 10 个）处理
    const batches = chunkArray(kps, 10);
    
    for (const batch of batches) {
      // 构建需要向量化的文本
      const texts = batch.map(kp => `${kp.name}\n${kp.description || ''}`);
      
      // 调用 Workers AI 进行 Embedding
      const embeddings = await c.env.AI.run(aiModel, {
        text: texts
      });
      console.log('embeddings shape:', embeddings.shape, 'data length:', embeddings.data.length);
      console.log('first element:', Array.isArray(embeddings.data[0]));

      // 我们直接取 embeddings.data[idx] 即可，因为它返回的就是 [10, 1024] 的 2D 数组
      const vectors = batch.map((kp, idx) => {
        const vectorValues = embeddings.data[idx];
        
        return {
          id: kp.id,
          values: vectorValues,
          metadata: {
            type: 'knowledge_point',
            name: kp.name,
            subject_id: kp.subject_id,
            chapter_id: kp.chapter_id,
            importance: kp.importance
          }
        };
      });

      // 插入到 Vectorize
      await c.env.VECTORIZE_INDEX.insert(vectors);
      embeddedCount += batch.length;
    }

    return c.json({ success: true, message: `Successfully embedded ${embeddedCount} knowledge points.` });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// 内部接口：根据解析的官方教材片段构建向量索引
rag.post('/embed-reference', async (c) => {
  try {
    const { results: refs } = await c.env.DB.prepare(
      'SELECT * FROM reference_materials'
    ).all();

    const aiModel = '@cf/baai/bge-m3';
    let embeddedCount = 0;

    const batches = chunkArray(refs, 5);
    
    for (const batch of batches) {
      // 强制截断，防止部分未能正确分段的超长文本撑爆 Cloudflare AI Token 限制 (最大 60000 tokens)
      // 对于中文，1000个字符大约2000-3000 tokens。截断在1500字符绝对安全。
      const texts = batch.map((r: any) => r.content.slice(0, 1500));
      
      try {
        const embeddings = await c.env.AI.run(aiModel, {
          text: texts
        });

        const vectors = batch.map((r: any, idx: number) => {
          return {
            id: r.id,
            values: embeddings.data[idx],
            metadata: {
              type: 'reference_material',
              source_file: r.source_file,
              chunk_index: r.chunk_index
            }
          };
        });

        await c.env.VECTORIZE_INDEX.insert(vectors);
        embeddedCount += batch.length;
      } catch (err: any) {
        console.error(`Failed to embed batch starting with id ${batch[0].id}:`, err.message);
        // Continue to the next batch even if one fails
      }
    }

    return c.json({ success: true, message: `Successfully embedded ${embeddedCount} reference chunks.` });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// 对外接口：基于自然语言搜索知识点
rag.post('/search', async (c) => {
  try {
    const { query } = await c.req.json();
    if (!query) {
      return c.json({ success: false, error: "Query is required" }, 400);
    }

    const aiModel = '@cf/baai/bge-m3';
    
    // 1. 对用户的提问进行向量化
    const queryEmbedding = await c.env.AI.run(aiModel, {
      text: [query]
    });
    // 对于 bge-m3，返回的是 2D 数组
    const queryVector = queryEmbedding.data[0];

    // 2. 查询 Vectorize 索引获取最相似的 Top K 个 ID
    const searchResults = await c.env.VECTORIZE_INDEX.query(queryVector, {
      topK: 5,
      returnValues: false,
      returnMetadata: true
    });

    if (searchResults.matches.length === 0) {
      return c.json({ success: true, data: [] });
    }

    // 3. 从 D1 获取这几个知识点的原始完整内容
    const matchedIds = searchResults.matches.map(m => m.id);
    const placeholders = matchedIds.map(() => '?').join(',');
    
    // We can have both knowledge_points and reference_materials in the search results
    const kpIds = searchResults.matches.filter(m => m.metadata?.type === 'knowledge_point').map(m => m.id);
    const refIds = searchResults.matches.filter(m => m.metadata?.type === 'reference_material').map(m => m.id);
    
    let kps: any[] = [];
    if (kpIds.length > 0) {
      const kpPlaceholders = kpIds.map(() => '?').join(',');
      const res = await c.env.DB.prepare(`SELECT * FROM knowledge_points WHERE id IN (${kpPlaceholders})`).bind(...kpIds).all();
      kps = res.results.map((k: any) => ({ ...k, display_type: '大纲考点' }));
    }

    let refs: any[] = [];
    if (refIds.length > 0) {
      const refPlaceholders = refIds.map(() => '?').join(',');
      const res = await c.env.DB.prepare(`SELECT * FROM reference_materials WHERE id IN (${refPlaceholders})`).bind(...refIds).all();
      refs = res.results.map((r: any) => ({ 
        id: r.id, 
        name: `《${r.source_file}》 第 ${r.chunk_index} 节`, 
        description: r.content,
        display_type: '官方教材'
      }));
    }
    
    const combined = [...kps, ...refs];

    // 保持搜索相关度排序
    const sortedCombined = searchResults.matches.map(match => {
      const item = combined.find(c => c.id === match.id);
      if (item) {
        return { ...item, score: match.score };
      }
      return null;
    }).filter(i => i !== null);

    return c.json({ success: true, data: sortedCombined });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})
// 对外接口：AI 智能辅导 (Agentic Tutoring)
rag.post('/tutor', async (c) => {
  try {
    const { question_id, user_answer, correct_answer, stem } = await c.req.json();
    if (!question_id || !user_answer) {
      return c.json({ success: false, error: "Missing required fields" }, 400);
    }

    // 1. 获取题目解析
    const expRes = await c.env.DB.prepare('SELECT explanation FROM question_explanations WHERE question_id = ?').bind(question_id).first();
    const explanation = expRes ? expRes.explanation : "暂无解析";

    // 2. 向量检索，寻找可能的考点支撑
    let contextText = "";
    try {
      const queryEmbedding = await c.env.AI.run('@cf/baai/bge-m3', { text: [stem] });
      const queryVector = queryEmbedding.data[0];
      const searchResults = await c.env.VECTORIZE_INDEX.query(queryVector, { topK: 3, returnValues: false, returnMetadata: true });
      
      if (searchResults.matches.length > 0) {
        const kpIds = searchResults.matches.filter(m => m.metadata?.type === 'knowledge_point').map(m => m.id);
        const refIds = searchResults.matches.filter(m => m.metadata?.type === 'reference_material').map(m => m.id);
        
        let kps: any[] = [];
        if (kpIds.length > 0) {
          const kpPlaceholders = kpIds.map(() => '?').join(',');
          const res = await c.env.DB.prepare(`SELECT name, description FROM knowledge_points WHERE id IN (${kpPlaceholders})`).bind(...kpIds).all();
          kps = res.results.map((k: any) => `【${k.name}】: ${k.description}`);
        }

        let refs: any[] = [];
        if (refIds.length > 0) {
          const refPlaceholders = refIds.map(() => '?').join(',');
          const res = await c.env.DB.prepare(`SELECT source_file, content FROM reference_materials WHERE id IN (${refPlaceholders})`).bind(...refIds).all();
          refs = res.results.map((r: any) => `【《${r.source_file}》】: ${r.content}`);
        }
        
        contextText = [...kps, ...refs].join('\n\n');
      }
    } catch (err) {
      console.warn("Vectorize search failed during tutor, falling back to basic prompt", err);
    }

    // 3. 构造 Prompt，调用 Llama 3 大模型
    const systemPrompt = `你是一位资深的专利代理师培训专家，耐心且幽默。
你的任务是辅导正在备考的考生。考生在做一道专利法考试题时选错了。
请基于给出的题干、官方解析以及参考大纲知识点，直接针对考生选择的错误选项进行点评和纠正。
请用聊天的口吻，一针见血地指出陷阱在哪里。不要直接复述题目或机械地读答案。`;

    const userPrompt = `
【题目】: ${stem}
【考生选择】: ${user_answer}
【正确答案】: ${correct_answer}
【官方解析】: ${explanation}
【相关知识点】: ${contextText}

请你辅导我，告诉我为什么我选的 ${user_answer} 是错的（或者遗漏了什么），以及我该怎么理解这道题？（输出格式为 Markdown，重点加粗，字数控制在 200 字以内）
`;

    const response = await c.env.AI.run('@cf/meta/llama-3-8b-instruct', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    });

    return c.json({ success: true, data: response.response });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// 对外接口：针对知识点生成题目 (AI 出题)
rag.post('/generate-question', async (c) => {
  try {
    const { knowledge_point_id } = await c.req.json();
    if (!knowledge_point_id) {
      return c.json({ success: false, error: "knowledge_point_id is required" }, 400);
    }

    // 获取知识点详情
    const kpRes = await c.env.DB.prepare('SELECT name, description FROM knowledge_points WHERE id = ?').bind(knowledge_point_id).first();
    if (!kpRes) {
      return c.json({ success: false, error: "Knowledge point not found" }, 404);
    }

    const systemPrompt = `你是一位国家知识产权局专利局资深出题专家。
请根据下面提供的【考点名称】和【考点详情】，为备考专利代理师资格考试的考生出一道单项选择题。
要求：
1. 题目必须有 A, B, C, D 四个选项。
2. 干扰项（错误选项）必须具备一定的迷惑性，符合该考点常见的易错点。
3. 必须输出一段详细的解析说明为什么选该答案以及其他选项错在哪里。
4. 你的输出必须是合法的纯 JSON 格式，不要包裹任何 Markdown 标记（不要有 \`\`\`json ），直接输出 JSON 对象。

JSON 格式要求如下：
{
  "stem": "题目正文",
  "options": [
    {"key": "A", "text": "选项A内容"},
    {"key": "B", "text": "选项B内容"},
    {"key": "C", "text": "选项C内容"},
    {"key": "D", "text": "选项D内容"}
  ],
  "correct_answer": "A",
  "explanation": "详细解析..."
}`;

    const userPrompt = `
【考点名称】: ${kpRes.name}
【考点详情】: ${kpRes.description || '无详细描述，请根据名称发挥。'}
`;

    // 调用 DeepSeek API
    const DEEPSEEK_API_KEY = 'sk-be0bd6eb961c4665aef9190ca910683b';
    const deepseekRes = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: "json_object" }
      })
    });

    if (!deepseekRes.ok) {
      const errorText = await deepseekRes.text();
      console.error("DeepSeek API Error:", errorText);
      return c.json({ success: false, error: "Failed to generate question from AI" }, 500);
    }

    const deepseekData: any = await deepseekRes.json();
    const content = deepseekData.choices[0].message.content;
    
    let questionData;
    try {
      questionData = JSON.parse(content);
    } catch (err) {
      console.error("Failed to parse AI response as JSON", content);
      // Fallback crude regex if JSON parse fails due to markdown blocks
      const jsonMatch = content.match(/\\{.*\\}/s);
      if (jsonMatch) {
        questionData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("Invalid JSON from AI");
      }
    }

    return c.json({ success: true, data: questionData });
  } catch (e: any) {
    console.error("Generate question error:", e);
    return c.json({ success: false, error: e.message }, 500)
  }
})

// 对外接口：并发生成一套 AI 全真模考卷
rag.post('/generate-mock-exam', async (c) => {
  try {
    const { count = 10 } = await c.req.json().catch(() => ({ count: 10 }));

    // 随机抽取 count 个知识点
    const kpRes = await c.env.DB.prepare('SELECT id, name, description FROM knowledge_points ORDER BY RANDOM() LIMIT ?').bind(count).all();
    if (!kpRes || kpRes.results.length === 0) {
      return c.json({ success: false, error: "No knowledge points found" }, 404);
    }

    const DEEPSEEK_API_KEY = 'sk-be0bd6eb961c4665aef9190ca910683b';

    // 定义并发任务
    const generateTasks = kpRes.results.map(async (kp: any, index: number) => {
      const systemPrompt = `你是一位国家知识产权局专利局资深出题专家。
请根据下面提供的【考点名称】和【考点详情】，为备考专利代理师资格考试的考生出一道单项选择题。
要求：
1. 题目必须有 A, B, C, D 四个选项。
2. 干扰项（错误选项）必须具备一定的迷惑性，符合该考点常见的易错点。
3. 必须输出一段详细的解析说明为什么选该答案以及其他选项错在哪里。
4. 你的输出必须是合法的纯 JSON 格式，直接输出 JSON 对象。

JSON 格式要求如下：
{
  "stem": "题目正文",
  "options": [
    {"key": "A", "text": "选项A内容"},
    {"key": "B", "text": "选项B内容"},
    {"key": "C", "text": "选项C内容"},
    {"key": "D", "text": "选项D内容"}
  ],
  "correct_answer": "A",
  "explanation": "详细解析..."
}`;

      const userPrompt = `
【考点名称】: ${kp.name}
【考点详情】: ${kp.description || '无详细描述，请根据名称发挥。'}
`;

      try {
        const res = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
          },
          body: JSON.stringify({
            model: 'deepseek-v4-flash',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            response_format: { type: "json_object" },
            temperature: 0.7
          })
        });

        if (!res.ok) {
          console.warn(`DeepSeek API failed for kp ${kp.id}: ${res.status}`);
          return null;
        }

        const data: any = await res.json();
        const content = data.choices[0].message.content;
        
        let qData;
        try {
          qData = JSON.parse(content);
        } catch (err) {
          const match = content.match(/\{.*\}/s);
          if (match) qData = JSON.parse(match[0]);
          else return null;
        }

        // 统一格式返回给前端
        return {
          id: `ai_${kp.id}_${Date.now()}_${index}`,
          knowledge_point_name: kp.name,
          stem: qData.stem,
          question_type: "single",
          options: qData.options.map((opt: any) => ({
            id: `opt_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            option_key: opt.key,
            option_text: opt.text
          })),
          correct_answer: qData.correct_answer,
          explanation: qData.explanation
        };
      } catch (err) {
        console.warn(`Fetch error for kp ${kp.id}`, err);
        return null;
      }
    });

    // 并发执行所有请求
    const results = await Promise.all(generateTasks);
    
    // 过滤掉生成失败的题目
    const validQuestions = results.filter(q => q !== null);

    return c.json({ 
      success: true, 
      data: validQuestions,
      meta: {
        requested: count,
        generated: validQuestions.length
      }
    });
  } catch (e: any) {
    console.error("Generate mock exam error:", e);
    return c.json({ success: false, error: e.message }, 500)
  }
})

// 对外接口：根据自定义主题生成一套 AI 全真模考卷
rag.post('/generate-custom-mock-exam', async (c) => {
  try {
    const { topic, count = 5 } = await c.req.json().catch(() => ({ topic: "", count: 5 }));

    if (!topic || topic.trim() === '') {
      return c.json({ success: false, error: "Topic is required" }, 400);
    }

    const DEEPSEEK_API_KEY = 'sk-be0bd6eb961c4665aef9190ca910683b';

    const systemPrompt = `你是一位国家知识产权局专利局资深出题专家。
请根据考生提供的【练习主题/要求】，为其出一套包含 ${count} 道题目的单项选择题微型试卷。
要求：
1. 题目之间要尽量覆盖该主题的不同侧面，避免重复。
2. 每道题目必须有 A, B, C, D 四个选项，并且必须有且仅有一个正确答案。
3. 干扰项（错误选项）必须具备一定的迷惑性，符合常见的易错点。
4. 必须输出一段详细的解析说明为什么选该答案以及其他选项错在哪里。
5. 你的输出必须是合法的纯 JSON 格式，直接输出一个 JSON 对象，对象内部包含一个名为 "questions" 的数组。不要包裹任何 Markdown 标记（不要有 \`\`\`json ）。
6. 严禁在 JSON 字符串值中直接使用真实的换行符，所有字符串内部的换行请严格使用 \\n 转义。

JSON 格式要求如下：
{
  "questions": [
    {
      "stem": "第一道题目的正文...",
      "question_type": "single", // "single" 表示单选，"multiple" 表示多选
      "options": [
        {"key": "A", "text": "选项A内容"},
        {"key": "B", "text": "选项B内容"},
        {"key": "C", "text": "选项C内容"},
        {"key": "D", "text": "选项D内容"}
      ],
      "correct_answer": "A",
      "explanation": "详细解析..."
    }
  ]
}`;

    const userPrompt = `
【练习主题/要求】: ${topic}
`;

    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
        max_tokens: 4096
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`DeepSeek API failed:`, errText);
      return c.json({ success: false, error: "AI API Request Failed" }, 500);
    }

    const data: any = await res.json();
    const content = data.choices[0].message.content;
    
    let parsedData;
    try {
      parsedData = JSON.parse(content);
    } catch (err) {
      const match = content.match(/\{.*\}/s);
      if (match) {
        parsedData = JSON.parse(match[0]);
      } else {
        return c.json({ success: false, error: "Failed to parse AI JSON" }, 500);
      }
    }

    if (!parsedData.questions || !Array.isArray(parsedData.questions)) {
      return c.json({ success: false, error: "Invalid AI response structure" }, 500);
    }

    // 格式化输出
    const formattedQuestions = parsedData.questions.map((qData: any, idx: number) => {
      return {
        id: `ai_custom_${Date.now()}_${idx}`,
        knowledge_point_name: topic,
        stem: qData.stem,
        question_type: qData.question_type === 'multiple' ? 'multiple' : 'single',
        options: qData.options.map((opt: any) => ({
          id: `opt_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          option_key: opt.key,
          option_text: opt.text
        })),
        correct_answer: qData.correct_answer,
        explanation: qData.explanation
      };
    });

    return c.json({ 
      success: true, 
      data: formattedQuestions,
      meta: { requested: count, generated: formattedQuestions.length, topic }
    });
  } catch (e: any) {
    console.error("Generate custom mock exam error:", e);
    return c.json({ success: false, error: e.message }, 500)
  }
})

export default rag;

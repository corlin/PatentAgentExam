import { Hono } from 'hono'
import { Bindings } from './exam'

const question = new Hono<{ Bindings: Bindings }>()

// 获取随机题目，或支持分页
question.get('/random', async (c) => {
  const limit = c.req.query('limit') || '5'
  
  try {
    // SQLite doesn't natively support easy random sampling efficiently for huge tables, 
    // but for our 100 questions, ORDER BY RANDOM() is fine
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM questions ORDER BY RANDOM() LIMIT ?'
    ).bind(parseInt(limit)).all()
    
    // For each question, fetch options
    for (let q of results) {
      const optionsRes = await c.env.DB.prepare(
        'SELECT * FROM question_options WHERE question_id = ? ORDER BY option_key ASC'
      ).bind(q.id).all()
      q.options = optionsRes.results
    }

    return c.json({ success: true, data: results })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// 提交答案，返回解析
question.post('/submit', async (c) => {
  try {
    const { question_id, user_id = 'default_user', user_answer, time_spent } = await c.req.json()
    
    // Check answer
    const qRes = await c.env.DB.prepare('SELECT answer FROM questions WHERE id = ?').bind(question_id).first()
    if (!qRes) {
      return c.json({ success: false, error: 'Question not found' }, 404)
    }
    
    const is_correct = qRes.answer === user_answer ? 1 : 0
    
    // Log user answer
    await c.env.DB.prepare(
      `INSERT INTO user_answers (id, user_id, question_id, user_answer, is_correct, time_spent)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind('ua_' + Date.now() + Math.random().toString(36).substring(7), user_id, question_id, user_answer, is_correct, time_spent).run()
    
    if (!is_correct) {
      // Add or update wrong book
      await c.env.DB.prepare(
        `INSERT INTO wrong_questions (id, user_id, question_id, wrong_reason, retry_count)
         VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(id) DO UPDATE SET retry_count = retry_count + 1, updated_at = CURRENT_TIMESTAMP`
      ).bind('wq_' + user_id + '_' + question_id, user_id, question_id, "Answered incorrectly").run()
    }
    
    // Fetch explanation
    const expRes = await c.env.DB.prepare('SELECT * FROM question_explanations WHERE question_id = ?').bind(question_id).first()
    
    return c.json({ 
      success: true, 
      data: {
        is_correct: is_correct === 1,
        correct_answer: qRes.answer,
        explanation: expRes ? expRes.explanation : null
      }
    })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// 生成模拟试卷
question.get('/mock-paper', async (c) => {
  const limit = c.req.query('limit') || '10'
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT id, stem, question_type FROM questions ORDER BY RANDOM() LIMIT ?'
    ).bind(parseInt(limit)).all()
    
    for (let q of results) {
      const optionsRes = await c.env.DB.prepare(
        'SELECT id, option_key, option_text FROM question_options WHERE question_id = ? ORDER BY option_key ASC'
      ).bind(q.id).all()
      q.options = optionsRes.results
    }
    return c.json({ success: true, data: results })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// 批量提交试卷
question.post('/submit-paper', async (c) => {
  try {
    const { user_id, answers, time_spent } = await c.req.json()
    if (!user_id || !answers) {
      return c.json({ success: false, error: 'Missing required fields' }, 400)
    }

    let correctCount = 0
    let results = []

    // 可以在正式环境中用批量 SQL 优化，为了简单先循环处理
    for (let ans of answers) {
      const { question_id, user_answer } = ans
      
      const qRes = await c.env.DB.prepare('SELECT answer FROM questions WHERE id = ?').bind(question_id).first()
      if (!qRes) continue
      
      const is_correct = qRes.answer === user_answer ? 1 : 0
      if (is_correct) correctCount++

      // 记录用户答题
      await c.env.DB.prepare(
        `INSERT INTO user_answers (id, user_id, question_id, user_answer, is_correct, time_spent)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind('ua_' + Date.now() + Math.random().toString(36).substring(7), user_id, question_id, user_answer, is_correct, 0).run()

      if (!is_correct) {
        await c.env.DB.prepare(
          `INSERT INTO wrong_questions (id, user_id, question_id, wrong_reason, retry_count)
           VALUES (?, ?, ?, ?, 1)
           ON CONFLICT(id) DO UPDATE SET retry_count = retry_count + 1, updated_at = CURRENT_TIMESTAMP`
        ).bind('wq_' + user_id + '_' + question_id, user_id, question_id, "Mock exam incorrect").run()
      }

      const expRes = await c.env.DB.prepare('SELECT explanation FROM question_explanations WHERE question_id = ?').bind(question_id).first()

      results.push({
        question_id,
        user_answer,
        correct_answer: qRes.answer,
        is_correct: is_correct === 1,
        explanation: expRes ? expRes.explanation : null
      })
    }

    return c.json({ 
      success: true, 
      data: {
        total: answers.length,
        correct: correctCount,
        time_spent,
        details: results
      }
    })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// 批量提交 AI 模考试卷并持久化
question.post('/submit-ai-batch', async (c) => {
  try {
    const { user_id, answers, questions, time_spent } = await c.req.json()
    if (!user_id || !answers || !questions) {
      return c.json({ success: false, error: 'Missing required fields' }, 400)
    }

    let correctCount = 0

    // 为了避免部分失败，我们可以将所有的操作放入一个 Promise.all 或一个大事务。
    // 这里出于简单性，我们在循环中插入，生产环境可优化为 batch
    for (let q of questions) {
      // 1. 将题目插入 questions 表
      // 检查是否已经存在（理论上 id 包含时间戳，不会重复，但以防万一可以用 INSERT OR IGNORE）
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO questions (id, subject_id, chapter_id, question_type, stem, answer, difficulty, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      ).bind(q.id, 'ai_subject', 'ai_chapter', q.question_type || 'single', q.stem, q.correct_answer, 'medium', 'AI_GENERATED').run()

      // 2. 插入选项
      for (let opt of (q.options || [])) {
        const is_correct = opt.option_key === q.correct_answer ? 1 : 0
        await c.env.DB.prepare(
          `INSERT OR IGNORE INTO question_options (id, question_id, option_key, option_text, is_correct)
           VALUES (?, ?, ?, ?, ?)`
        ).bind(opt.id || ('opt_' + Date.now() + Math.random().toString(36).substring(7)), q.id, opt.option_key, opt.option_text, is_correct).run()
      }

      // 3. 插入解析
      if (q.explanation) {
        await c.env.DB.prepare(
          `INSERT OR IGNORE INTO question_explanations (id, question_id, explanation, created_by, created_at)
           VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`
        ).bind('exp_' + q.id, q.id, q.explanation, 'AI_SYSTEM').run()
      }

      // 4. 判题与插入作答记录
      const userAnsStr = (answers[q.id] || []).join("")
      const is_correct = userAnsStr === q.correct_answer ? 1 : 0
      if (is_correct) correctCount++

      await c.env.DB.prepare(
        `INSERT INTO user_answers (id, user_id, question_id, user_answer, is_correct, time_spent)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind('ua_' + Date.now() + Math.random().toString(36).substring(7), user_id, q.id, userAnsStr, is_correct, Math.floor(time_spent / questions.length) || 0).run()

      // 5. 加入错题本
      if (!is_correct) {
        await c.env.DB.prepare(
          `INSERT INTO wrong_questions (id, user_id, question_id, wrong_reason, retry_count)
           VALUES (?, ?, ?, ?, 1)
           ON CONFLICT(id) DO UPDATE SET retry_count = retry_count + 1, updated_at = CURRENT_TIMESTAMP`
        ).bind('wq_' + user_id + '_' + q.id, user_id, q.id, "AI Mock exam incorrect").run()
      }
    }

    return c.json({ 
      success: true, 
      data: {
        total: questions.length,
        correct: correctCount,
        time_spent
      }
    })
  } catch (e: any) {
    console.error("AI Batch Submit Error:", e)
    return c.json({ success: false, error: e.message }, 500)
  }
})

export default question

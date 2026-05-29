import { Hono } from 'hono'
import { Subject, Chapter, KnowledgePoint } from '../../../../packages/shared/src/types/exam'

export type Bindings = {
  DB: D1Database;
};

const exam = new Hono<{ Bindings: Bindings }>()

// 获取所有的考试科目
exam.get('/subjects', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM exam_subjects ORDER BY sort_order ASC'
    ).all<Subject>()
    return c.json({ success: true, data: results })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// 获取特定科目的所有章节
exam.get('/subjects/:id/chapters', async (c) => {
  const subjectId = c.req.param('id')
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM exam_chapters WHERE subject_id = ? ORDER BY sort_order ASC'
    ).bind(subjectId).all<Chapter>()
    return c.json({ success: true, data: results })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// 获取特定章节的所有知识点
exam.get('/chapters/:id/knowledge-points', async (c) => {
  const chapterId = c.req.param('id')
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM knowledge_points WHERE chapter_id = ? ORDER BY sort_order ASC'
    ).bind(chapterId).all<KnowledgePoint>()
    return c.json({ success: true, data: results })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// 获取完整的树状结构 (科目 -> 章节 -> 知识点)
exam.get('/tree', async (c) => {
  try {
    const db = c.env.DB
    
    const [subjectsRes, chaptersRes, kpsRes] = await Promise.all([
      db.prepare('SELECT * FROM exam_subjects ORDER BY sort_order ASC').all<Subject>(),
      db.prepare('SELECT * FROM exam_chapters ORDER BY sort_order ASC').all<Chapter>(),
      db.prepare('SELECT * FROM knowledge_points ORDER BY sort_order ASC').all<KnowledgePoint>()
    ])
    
    const subjects = subjectsRes.results
    const chapters = chaptersRes.results
    const kps = kpsRes.results
    
    // 构建树
    const tree = subjects.map(subject => {
      return {
        ...subject,
        chapters: chapters
          .filter(chap => chap.subject_id === subject.id)
          .map(chap => ({
            ...chap,
            knowledge_points: kps.filter(kp => kp.chapter_id === chap.id)
          }))
      }
    })
    
    return c.json({ success: true, data: tree })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

export default exam

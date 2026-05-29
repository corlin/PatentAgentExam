import { Hono } from 'hono'
import examRouter, { Bindings } from './routes/exam'

const app = new Hono<{ Bindings: Bindings }>()

app.get('/', (c) => {
  return c.text('PatentExam API Worker is running!')
})

import ragRouter from './routes/rag'
import questionRouter from './routes/question'
import userRouter from './routes/user'

app.route('/api/exam', examRouter)
app.route('/api/rag', ragRouter)
app.route('/api/question', questionRouter)
app.route('/api/user', userRouter)

export default app

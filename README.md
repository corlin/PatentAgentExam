# 专利代理师 AI 备考助手 (Patent Agent Exam AI Assistant)

这是一个专为中国大陆专利代理师资格考试打造的 AI 辅助备考 Web 应用。它摆脱了传统的“纯对话框式 AI”体验，通过“RAG + Agent Skill”混合架构，将大模型的能力深度融入到了查知识点、动态刷题、实务诊断等真实备考场景中，形成完整的“学习-评测-反馈”数据闭环。

## ✨ 核心特性 (Features)

- 🧠 **一句话动态组卷 (RAG 溯源引擎)**：基于用户输入（例如“关于无效宣告的考点”），系统会首先通过大模型进行语义向量化，在包含 5000+ 条《专利法》及《审查指南》的向量库中检索最相关的法条文本。随后，要求大模型**严格基于检索到的法条原文**动态编纂考题，并在解析中明确引经据典，从根本上杜绝 AI 出题的“幻觉”。支持单选、多选混排。
- 📊 **专属能力雷达图**：告别盲目刷题。基于答题记录，实时生成个人掌握度雷达图，直观展现您在专利法基础、实务程序等不同维度的强弱项。
- 📔 **智能错题本系统**：所有在 AI 模考中做错的题目将自动落库至“智能错题本”，保留做错次数与时间，方便后续集中攻坚复习。
- 🛡️ **现代化 UI 体验**：采用 Glassmorphism（毛玻璃）风格的 Dashboard 与沉浸式刷题界面，在保证长时间专注的同时提供极佳的视觉体验。

## 🛠️ 技术栈 (Tech Stack)

本项目采用全栈 Serverless 架构，借助 Cloudflare 生态实现极低成本的快速构建与弹性扩展：

- **Frontend (前端)**: [Next.js](https://nextjs.org/) (React), Tailwind CSS, Recharts, Lucide Icons
- **Backend (后端)**: [Cloudflare Workers](https://workers.cloudflare.com/), [Hono](https://hono.dev/) Web Framework
- **Database (数据库)**: [Cloudflare D1](https://developers.cloudflare.com/d1/) (Serverless SQLite) + **Cloudflare Vectorize** (向量检索数据库)
- **AI Engine (大模型)**: 深度集成 DeepSeek API 用于动态出题与解析，集成 Cloudflare Workers AI (`@cf/baai/bge-m3`) 用于文档向量化与语义搜索

## 📂 项目结构 (Project Structure)

```text
PatentAgentExam/
├── apps/
│   └── web/               # Next.js 前端应用，包含控制台、模考页、知识大纲等
├── workers/
│   └── api/               # Cloudflare Workers 后端服务 (Hono)
│       └── src/routes/    # 路由目录，包含 rag.ts, question.ts, user.ts 等
├── migrations/
│   └── d1/                # 数据库迁移脚本
└── scripts/               # 数据清洗、导入脚本及测试工具
```

## 🚀 快速启动 (Quick Start)

### 1. 后端 (Workers API)
进入后端目录并安装依赖，启动本地/远程开发服务器：
```bash
cd workers/api
npm install

# (可选) 应用数据库迁移
npx wrangler d1 migrations apply patent-exam-db --remote

# 启动 Worker 开发服务器
npx wrangler dev --remote
```

### 2. 前端 (Next.js)
进入前端目录并启动开发环境（确保已配置相关环境变量）：
```bash
cd apps/web
npm install

# 启动 Next.js 
npm run dev
```
打开浏览器访问 [http://localhost:3000](http://localhost:3000) 即可预览。

## 📜 许可证 (License)

MIT License.

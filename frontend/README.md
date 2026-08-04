# Vue 3 + TypeScript + Vite

This template should help get you started developing with Vue 3 and TypeScript in Vite. The template uses Vue 3 `<script setup>` SFCs, check out the [script setup docs](https://v3.vuejs.org/api/sfc-script-setup.html#sfc-script-setup) to learn more.

Learn more about the recommended Project Setup and IDE Support in the [Vue Docs TypeScript Guide](https://vuejs.org/guide/typescript/overview.html#project-setup).

```aiignore
frontend/src/
├── api/agent.ts              # TypeScript 类型 + fetch 封装
├── composables/
│   └── useAgentPlan.ts       # 状态管理（progressive event reveal）
├── components/
│   ├── AppHeader.vue         # 顶栏：Logo / 模型信息 / JSON调试按钮
│   ├── PlanInput.vue         # 左侧输入面板
│   ├── AgentConsole.vue      # 主控制台（Tab系统）
│   ├── PlanSidebar.vue       # 步骤进度列（左列）
│   ├── EventFeed.vue         # 事件流（中列，渐进式动画展示）
│   └── ContextPanel.vue      # 路线摘要面板（右列：POI卡片/预算/天气）
├── style.css                 # 深色主题 CSS 变量
└── App.vue                   # 根布局，provide 共享状态
```
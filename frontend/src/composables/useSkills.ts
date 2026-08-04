import { computed, ref, watch, type Ref } from 'vue'

export interface UserSkill {
  id: string
  name: string
  description: string
  instruction: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface SkillDraft {
  name: string
  description: string
  instruction: string
  enabled: boolean
}

const DEFAULT_SKILLS: Omit<UserSkill, 'createdAt' | 'updatedAt'>[] = [
  {
    id: 'family-friendly',
    name: '亲子友好',
    description: '控制步行强度，并优先考虑儿童兴趣、安全和休息点。',
    instruction: '识别孩子年龄和同行人数；缩短连续步行距离，安排卫生间、用餐与可坐下休息的位置，并明确儿童安全提示。',
    enabled: true,
  },
  {
    id: 'accessible-rest',
    name: '无障碍与休息点',
    description: '为行动不便者、老人或需要频繁休息的人优化路线。',
    instruction: '优先平坦路面、无障碍入口和电梯；降低台阶与爬坡强度，并在每段路线中标明可休息位置。',
    enabled: true,
  },
  {
    id: 'weather-safe',
    name: '天气避险',
    description: '根据当日天气准备室内替代点和风险提醒。',
    instruction: '核对路线时段的天气；为降雨、高温、大风等情况准备可执行的室内替代点，并说明何时应切换方案。',
    enabled: true,
  },
  {
    id: 'literary-city',
    name: '文艺主题',
    description: '偏向书店、展览、建筑、街巷与安静的城市观察。',
    instruction: '围绕用户自己的风格描述选择有内容关联的地点，减少商业化打卡点，并说明地点之间的主题联系。',
    enabled: true,
  },
  {
    id: 'nature-explore',
    name: '自然探索',
    description: '增加绿地、水岸、动植物观察和季节性体验。',
    instruction: '优先连续绿地、水岸或生态观察点，结合季节和天气提示最佳观察内容，并避免破坏自然环境。',
    enabled: true,
  },
]

function uid(): string {
  return `skill_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function defaultSkills(): UserSkill[] {
  const now = new Date().toISOString()
  return DEFAULT_SKILLS.map(skill => ({ ...skill, createdAt: now, updatedAt: now }))
}

function validSkills(value: unknown): value is UserSkill[] {
  return Array.isArray(value) && value.every(skill => {
    if (!skill || typeof skill !== 'object') return false
    const item = skill as Partial<UserSkill>
    return typeof item.id === 'string' && typeof item.name === 'string'
      && typeof item.description === 'string' && typeof item.instruction === 'string'
      && typeof item.enabled === 'boolean'
  })
}

export function useSkills(userId: Ref<string | undefined>) {
  const skills = ref<UserSkill[]>([])
  const storageKey = computed(() => `citywalk-user-skills:${userId.value ?? 'anonymous'}`)

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey.value) ?? 'null') as unknown
      skills.value = validSkills(saved) ? saved : defaultSkills()
    } catch {
      skills.value = defaultSkills()
    }
  }

  function persist() {
    localStorage.setItem(storageKey.value, JSON.stringify(skills.value))
  }

  watch(userId, load, { immediate: true })
  watch(skills, persist, { deep: true })

  function createSkill(draft: SkillDraft): UserSkill {
    const now = new Date().toISOString()
    const skill: UserSkill = {
      id: uid(),
      name: draft.name.trim(),
      description: draft.description.trim(),
      instruction: draft.instruction.trim(),
      enabled: draft.enabled,
      createdAt: now,
      updatedAt: now,
    }
    skills.value.push(skill)
    return skill
  }

  function updateSkill(id: string, patch: Partial<SkillDraft>) {
    const skill = skills.value.find(item => item.id === id)
    if (!skill) return
    if (typeof patch.name === 'string') skill.name = patch.name.trim()
    if (typeof patch.description === 'string') skill.description = patch.description.trim()
    if (typeof patch.instruction === 'string') skill.instruction = patch.instruction.trim()
    if (typeof patch.enabled === 'boolean') skill.enabled = patch.enabled
    skill.updatedAt = new Date().toISOString()
  }

  function toggleSkill(id: string) {
    const skill = skills.value.find(item => item.id === id)
    if (skill) updateSkill(id, { enabled: !skill.enabled })
  }

  function removeSkill(id: string) {
    skills.value = skills.value.filter(item => item.id !== id)
  }

  return { skills, createSkill, updateSkill, toggleSkill, removeSkill }
}

export type SkillController = ReturnType<typeof useSkills>

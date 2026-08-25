import { computed, ref, watch, type Ref } from 'vue'
import {
  apiCreateSkill, apiDeleteSkill, apiListSkills, apiUpdateSkill,
  type AgentIntent, type AgentSkill, type AgentSkillActivation, type AgentSkillPriority
} from '../api/agent'

export interface UserSkill extends AgentSkill {}

export interface SkillDraft {
  name: string
  description: string
  instruction: string
  enabled: boolean
  applicableIntents: AgentIntent[]
  activation: AgentSkillActivation
  priority: AgentSkillPriority
}

const DEFAULT_SKILL_VERSION = 3
const DEFAULT_SKILLS: Omit<UserSkill, 'createdAt' | 'updatedAt' | 'version'>[] = [
  {
    id: 'family-friendly', name: '亲子友好',
    description: '用户明确带孩子时，降低连续步行负担，照顾年龄差异和沿途休息。',
    instruction: '仅依据用户本轮明确提供的同行人数与孩子年龄规划；不要自行补全人数或年龄。缩短连续步行，安排可坐下休息、卫生间和安全提示；亲子友好是路线筛选偏好，不要把所有地点改成儿童乐园。',
    enabled: true, applicableIntents: ['route_create', 'route_modify', 'route_review'], activation: 'manual', priority: 'preference'
  },
  {
    id: 'accessible-rest', name: '轻松休息',
    description: '降低连续行动负担，优先安排可坐下休息和卫生间的停留点。',
    instruction: '采用轻松节奏，缩短连续步行，安排可坐下休息和卫生间；不要把休息条件当作安全设施保证，无法核验时明确标注。',
    enabled: true, applicableIntents: ['route_create', 'route_modify', 'route_review'], activation: 'manual', priority: 'requirement'
  },
  {
    id: 'wheelchair-access', name: '轮椅无障碍',
    description: '用户明确需要轮椅或无障碍通行时，逐段核验设施并暴露无法确认的风险。',
    instruction: '用户选择此 Skill 表示需要轮椅无障碍通行：要求无台阶、可用电梯和无障碍卫生间，逐段核验入口、坡道与休息条件；无法从地图或公开来源确认时必须明确标注，不得凭地点名称猜测。',
    enabled: true, applicableIntents: ['route_create', 'route_modify', 'route_review'], activation: 'manual', priority: 'requirement'
  },
  {
    id: 'weather-safe', name: '雨天室内备选',
    description: '选择后在指定时段出现降雨、高温或大风风险时切换室内优先方案。',
    instruction: '选择此 Skill 后，先核对用户指定日期和出发时段的天气；遇到降雨、高温或大风时采用室内优先，准备可执行的替代点并说明切换条件。天气正常时保留户外路线，不要擅自改城市或日期。',
    enabled: true, applicableIntents: ['route_create', 'route_modify', 'route_review'], activation: 'manual', priority: 'preference'
  },
  {
    id: 'literary-city', name: '文艺城市观察',
    description: '围绕书店、展览、建筑和街巷建立主题联系，保留用户自定义风格。',
    instruction: '把用户的文艺或人文描述拆成可观察场景和地点线索；优先有内容关联的书店、展览、建筑与街巷，减少单纯打卡式串点。解释地点之间的主题联系，不要用“文艺”一词替代具体证据。',
    enabled: true, applicableIntents: ['route_create', 'route_modify', 'poi_discovery'], activation: 'manual', priority: 'preference'
  },
  {
    id: 'nature-explore', name: '自然探索',
    description: '将绿地、水岸和季节观察组织成有节奏的户外路线。',
    instruction: '优先连续绿地、水岸、湿地或生态观察点，结合日期与天气说明适合观察的内容；保留必要的城市补给点，不要为了“自然”强行删除休息和卫生间。提醒遵守开放区域和环境保护要求。',
    enabled: true, applicableIntents: ['route_create', 'route_modify', 'poi_discovery'], activation: 'manual', priority: 'preference'
  },
  {
    id: 'local-discovery', name: '在地小众发现',
    description: '用户明确想避开网红或游客扎堆时，寻找有公开线索且可地图核验的小店与街区。',
    instruction: '只有用户明确提出小众、冷门、避开网红或本地生活时才使用长尾发现；优先公开网页线索，再用地图核验名称、地址和坐标。不要把“评分低”当作小众证据，也不要为了小众牺牲安全、营业状态和交通可达性。',
    enabled: true, applicableIntents: ['route_create', 'route_modify', 'poi_discovery'], activation: 'manual', priority: 'preference'
  },
]

const LEGACY_DEFAULTS: Record<string, { description: string; instruction: string }> = {
  'family-friendly': { description: '控制步行强度，并优先考虑儿童兴趣、安全和休息点。', instruction: '识别孩子年龄和同行人数；缩短连续步行距离，安排卫生间、用餐与可坐下休息的位置，并明确儿童安全提示。' },
  'accessible-rest': { description: '为行动不便者、老人或需要频繁休息的人优化路线。', instruction: '优先平坦路面、无障碍入口和电梯；降低台阶与爬坡强度，并在每段路线中标明可休息位置。' },
  'weather-safe': { description: '根据当日天气准备室内替代点和风险提醒。', instruction: '核对路线时段的天气；为降雨、高温、大风等情况准备可执行的室内替代点，并说明何时应切换方案。' },
  'literary-city': { description: '偏向书店、展览、建筑、街巷与安静的城市观察。', instruction: '围绕用户自己的风格描述选择有内容关联的地点，减少商业化打卡点，并说明地点之间的主题联系。' },
  'nature-explore': { description: '增加绿地、水岸、动植物观察和季节性体验。', instruction: '优先连续绿地、水岸或生态观察点，结合季节和天气提示最佳观察内容，并避免破坏自然环境。' },
}

// A previous built-in version is upgraded only when the user has not edited it.
const PREVIOUS_DEFAULTS: Record<string, { description: string; instruction: string }> = {
  'weather-safe': { description: '自动核对计划出行时段的天气，并给出可执行的调整建议。', instruction: '核对用户指定日期和出发时段的天气；区分实时可用、预报可用和无法判断。遇到降雨、高温或大风，优先提出室内替代或缩短暴露路段，并说明切换条件；不要因为天气 Skill 擅自改城市或日期。' },
  'accessible-rest': { description: '用户提出行动或无障碍需求时，优先可核验的平坦通行与休息条件。', instruction: '用户明确提出轮椅、无台阶、电梯、无障碍卫生间或频繁休息需求时，将其作为硬约束并逐段核验；否则只提供温和的休息建议。不要凭地点名称推断无障碍设施，无法核验时明确标注。' },
}

function uid(): string { return `skill_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}` }
function defaultSkills(): UserSkill[] {
  const now = new Date().toISOString()
  return DEFAULT_SKILLS.map(skill => ({ ...skill, version: DEFAULT_SKILL_VERSION, createdAt: now, updatedAt: now }))
}
function validSkills(value: unknown): value is UserSkill[] {
  return Array.isArray(value) && value.every(skill => {
    if (!skill || typeof skill !== 'object') return false
    const item = skill as Partial<UserSkill>
    return typeof item.id === 'string' && typeof item.name === 'string' && typeof item.description === 'string'
      && typeof item.instruction === 'string' && typeof item.enabled === 'boolean'
  })
}

function toDraft(skill: UserSkill): SkillDraft {
  return { name: skill.name, description: skill.description, instruction: skill.instruction, enabled: skill.enabled, applicableIntents: skill.applicableIntents ?? [], activation: skill.activation ?? 'manual', priority: skill.priority ?? 'preference' }
}

function isLegacyDefault(skill: Partial<UserSkill>): boolean {
  const legacy = LEGACY_DEFAULTS[skill.id ?? ''] ?? PREVIOUS_DEFAULTS[skill.id ?? '']
  return Boolean(legacy && skill.description === legacy.description && skill.instruction === legacy.instruction)
}

function upgradeBuiltIn(skill: UserSkill): UserSkill {
  const next = DEFAULT_SKILLS.find(item => item.id === skill.id)
  if (!next || !isLegacyDefault(skill) || (skill.version ?? 1) >= DEFAULT_SKILL_VERSION) return skill
  return { ...skill, ...next, version: DEFAULT_SKILL_VERSION, updatedAt: new Date().toISOString() }
}

function createPayload(skill: UserSkill) {
  return {
    id: skill.id, name: skill.name, description: skill.description, instruction: skill.instruction,
    enabled: skill.enabled, applicableIntents: skill.applicableIntents, activation: skill.activation,
    priority: skill.priority, version: skill.version
  }
}

export function useSkills(userId: Ref<string | undefined>) {
  const skills = ref<UserSkill[]>([])
  const hydrating = ref(false)
  const storageKey = computed(() => `citywalk-user-skills:${userId.value ?? 'anonymous'}`)

  function loadLocal(): UserSkill[] {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey.value) ?? 'null') as unknown
      return validSkills(saved) ? saved.map(item => upgradeBuiltIn({ ...item, version: item.version ?? 1, applicableIntents: item.applicableIntents ?? [], activation: item.activation ?? 'manual', priority: item.priority ?? 'preference' })) : defaultSkills()
    } catch { return defaultSkills() }
  }

  async function load() {
    hydrating.value = true
    const local = loadLocal()
    skills.value = local
    if (userId.value) {
      try {
        let remote = await apiListSkills()
        if (!remote.length && local.length) {
          for (const skill of local) {
            try { await apiCreateSkill(createPayload(skill)) } catch { /* an individual duplicate must not block the migration */ }
          }
          remote = await apiListSkills()
        } else if (remote.length) {
          const remoteById = new Map(remote.map(skill => [skill.id, skill]))
          for (const builtIn of DEFAULT_SKILLS) {
            const existing = remoteById.get(builtIn.id)
            if (!existing) {
              try { remote.push(await apiCreateSkill({ ...builtIn, version: DEFAULT_SKILL_VERSION })) } catch { /* offline or a concurrent migration */ }
            } else if (isLegacyDefault(existing)) {
              try {
                const upgraded = await apiUpdateSkill(existing.id, createPayload({ ...existing, ...builtIn, version: DEFAULT_SKILL_VERSION }))
                remote.splice(remote.findIndex(skill => skill.id === existing.id), 1, upgraded)
              } catch { /* preserve the server copy if upgrade is temporarily unavailable */ }
            }
          }
        }
        if (remote.length) skills.value = remote.map(upgradeBuiltIn)
      } catch { /* local cache remains a usable offline fallback */ }
    }
    hydrating.value = false
    persist()
  }

  function persist() {
    localStorage.setItem(storageKey.value, JSON.stringify(skills.value))
  }
  watch(userId, () => { void load() }, { immediate: true })
  watch(skills, () => { if (!hydrating.value) persist() }, { deep: true })

  function createSkill(draft: SkillDraft): UserSkill {
    const now = new Date().toISOString()
    const skill: UserSkill = { id: uid(), name: draft.name.trim(), description: draft.description.trim(), instruction: draft.instruction.trim(), enabled: draft.enabled, applicableIntents: draft.applicableIntents, activation: draft.activation, priority: draft.priority, version: 1, createdAt: now, updatedAt: now }
    skills.value.push(skill)
    if (userId.value) void apiCreateSkill(createPayload(skill)).then(remote => { const index = skills.value.findIndex(item => item.id === skill.id); if (index >= 0) skills.value[index] = remote }).catch(() => undefined)
    return skill
  }

  function updateSkill(id: string, patch: Partial<SkillDraft>) {
    const skill = skills.value.find(item => item.id === id)
    if (!skill) return
    Object.assign(skill, patch.name === undefined ? {} : { name: patch.name.trim() }, patch.description === undefined ? {} : { description: patch.description.trim() }, patch.instruction === undefined ? {} : { instruction: patch.instruction.trim() }, patch.enabled === undefined ? {} : { enabled: patch.enabled }, patch.applicableIntents === undefined ? {} : { applicableIntents: patch.applicableIntents }, patch.activation === undefined ? {} : { activation: patch.activation }, patch.priority === undefined ? {} : { priority: patch.priority })
    skill.updatedAt = new Date().toISOString()
    if (userId.value) void apiUpdateSkill(id, { ...patch, version: skill.version }).then(remote => { const index = skills.value.findIndex(item => item.id === id); if (index >= 0) skills.value[index] = remote }).catch(() => undefined)
  }
  function toggleSkill(id: string) { const skill = skills.value.find(item => item.id === id); if (skill) updateSkill(id, { enabled: !skill.enabled }) }
  function removeSkill(id: string) { skills.value = skills.value.filter(item => item.id !== id); if (userId.value) void apiDeleteSkill(id).catch(() => undefined) }
  return { skills, createSkill, updateSkill, toggleSkill, removeSkill, toDraft }
}
export type SkillController = ReturnType<typeof useSkills>

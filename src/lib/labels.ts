import type { AgentKind, AgentRole } from '../types';

export const KIND_LABEL: Record<AgentKind, string> = {
  chatgpt: 'ChatGPT', 'claude-code-web': 'Claude Code Web', 'claude-code-cli': 'Claude Code CLI',
  'codex-cloud': 'Codex Cloud', 'codex-cli': 'Codex CLI', gemini: 'Gemini', other: 'その他', human: '人間（旧）',
};
/** Kinds offered for new/edited agents ('human' is legacy and only shown for existing data). */
export const SELECTABLE_KINDS: AgentKind[] = ['chatgpt', 'claude-code-web', 'claude-code-cli', 'codex-cloud', 'codex-cli', 'gemini', 'other'];

export const ROLE_LABEL: Record<AgentRole, string> = {
  dev_manager: '開発管理', dev_lead: '開発リーダー', spec_design: '仕様策定・設計', developer: '開発・実装', reviewer: 'レビュー', qa: 'テスト・品質管理',
};
export const ROLE_ORDER: AgentRole[] = ['dev_manager', 'dev_lead', 'spec_design', 'developer', 'reviewer', 'qa'];

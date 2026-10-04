import { mattermost } from "./mattermost.js";
import type { I18nDictionary } from "./en.js";

/**
 * Korean localization for OpenCode Mattermost Bot.
 *
 * Keep upstream emoji and technical terms where they help recognition.
 * Prefer natural Korean wording over literal translation.
 * Keep this dictionary complete to avoid falling back to another locale.
 */
export const ko: I18nDictionary = {
  ...mattermost,
  "cmd.description.recent": "모든 프로젝트의 최근 세션",
  "cmd.description.status": "서버 및 세션 상태",
  "cmd.description.new": "새 세션 만들기",
  "cmd.description.stop": "현재 작업 중지",
  "cmd.description.detach": "현재 세션에서 분리",
  "cmd.description.sessions": "세션 목록 보기",
  "cmd.description.messages": "세션 메시지 탐색",
  "cmd.description.settings": "봇 설정 변경",
  "cmd.description.projects": "프로젝트 목록 보기",
  "cmd.description.worktree": "git 워크트리 전환",
  "cmd.description.task": "예약 작업 만들기",
  "cmd.description.tasklist": "예약 작업 목록 보기",
  "cmd.description.commands": "사용자 지정 명령어",
  "cmd.description.skills": "스킬 카탈로그",
  "cmd.description.mcps": "MCP 서버",
  "cmd.description.opencode_start": "OpenCode 서버 시작",
  "cmd.description.opencode_stop": "OpenCode 서버 중지",
  "cmd.description.reload": "Reload OpenCode configuration",
  "cmd.description.ls": "디렉터리 내용 보기",
  "cmd.description.help": "도움말",

  "error.load_agents": "❌ 에이전트 목록을 불러오지 못했습니다",
  "error.load_models": "❌ 모델 목록을 불러오지 못했습니다",
  "error.load_variants": "❌ 변형 목록을 불러오지 못했습니다",
  "error.context_button": "❌ 컨텍스트 버튼을 처리하지 못했습니다",
  "error.generic": "🔴 문제가 발생했습니다.",

  "common.cancelled": "취소됨",
  "common.unknown": "알 수 없음",
  "common.unknown_error": "알 수 없는 오류",

  "agent.changed_message": "✅ 에이전트가 변경되었습니다: {name}",
  "agent.change_error_callback": "에이전트 변경 실패",
  "agent.menu.current": "현재 에이전트: {name}\n\n에이전트를 선택하세요:",
  "agent.menu.select": "에이전트를 선택하세요:",
  "agent.menu.empty": "⚠️ 사용 가능한 에이전트가 없습니다",
  "agent.menu.error": "🔴 에이전트 목록을 가져오지 못했습니다",

  "model.changed_message": "✅ 모델이 변경되었습니다: {name}",
  "model.change_error_callback": "모델 변경 실패",
  "model.menu.empty": "⚠️ 사용 가능한 모델이 없습니다",
  "model.menu.select": "모델을 선택하세요:",
  "model.menu.current": "현재 모델: {name}\n\n모델을 선택하세요:",
  "model.menu.favorites_title": "⭐ 즐겨찾기 (OpenCode CLI에서 모델을 즐겨찾기에 추가하세요)",
  "model.menu.favorites_empty": "— 비어 있음.",
  "model.menu.recent_title": "🕘 최근 사용",
  "model.menu.recent_empty": "— 비어 있음.",
  "model.menu.favorites_hint":
    "ℹ️ OpenCode CLI에서 모델을 즐겨찾기에 추가하면 목록 상단에 고정됩니다.",
  "model.menu.error": "🔴 모델 목록을 가져오지 못했습니다",
  "model.search.button": "🔍 검색",
  "model.search.prompt": "🔍 검색할 모델 이름을 입력하세요:",
  "model.search.results_title": '"{query}" 검색 결과:',
  "model.search.no_results": '"{query}"에 대한 모델을 찾을 수 없습니다',
  "model.search.search_again": "↩ 다시 검색",
  "model.search.error": "검색에 실패했습니다",
  "model.button.back": "⬅️ 뒤로",
  "model.providers.button": "🗂 프로바이더",
  "model.providers.title": "목록에서 프로바이더를 선택하세요:",
  "model.providers.empty": "⚠️ 연결된 프로바이더가 없습니다",
  "model.providers.error": "프로바이더 목록을 가져오지 못했습니다",
  "model.providers.page_indicator": "{current}/{total} 페이지",
  "model.providers.prev_page": "⬅️ 이전",
  "model.providers.next_page": "다음 ➡️",
  "model.provider_models.title": "{provider} — 모델을 선택하세요:",
  "model.provider_models.empty": "⚠️ {provider}에서 사용 가능한 모델이 없습니다",
  "model.provider_models.page_indicator": "{current}/{total} 페이지",

  "variant.model_not_selected_callback": "오류: 모델이 선택되지 않았습니다",
  "variant.changed_message": "✅ 변형이 변경되었습니다: {name}",
  "variant.change_error_callback": "변형 변경 실패",
  "variant.select_model_first": "⚠️ 먼저 모델을 선택해 주세요",
  "variant.menu.empty": "⚠️ 사용 가능한 변형이 없습니다",
  "variant.menu.current": "현재 변형: {name}\n\n변형을 선택하세요:",
  "variant.menu.error": "🔴 변형 목록을 가져오지 못했습니다",

  "runtime.container.command_unavailable": "⚠️ 이 명령은 Docker 이미지에서 사용할 수 없습니다.",

  "task.prompt.schedule":
    "⏰ 작업 일정을 자연어로 입력하세요.\n\n예시:\n- 5분마다\n- 매일 17:00\n- 내일 12:00",
  "task.schedule_empty": "⚠️ 일정은 비워 둘 수 없습니다.",
  "task.parse.in_progress": "⏳ 일정을 해석하는 중...",
  "task.parse_error":
    "🔴 일정을 해석하지 못했습니다.\n\n{message}\n\n더 명확한 형태로 일정을 다시 보내 주세요.",
  "task.schedule_preview":
    "✅ 일정이 해석되었습니다\n\n이렇게 이해했습니다: {summary}\n{cronLine}시간대: {timezone}\n유형: {kind}\n다음 실행: {nextRunAt}",
  "task.schedule_preview.cron": "Cron: {cron}",
  "task.prompt.body": "📝 이제 봇이 정해진 일정에 수행할 작업 내용을 보내주세요.",
  "task.prompt_empty": "⚠️ 작업 내용은 비워 둘 수 없습니다.",
  "task.created":
    "✅ 예약 작업이 생성되었습니다\n\n작업: {description}\n프로젝트: {project}\n에이전트: {agent}\n모델: {model}\n일정: {schedule}\n{cronLine}다음 실행: {nextRunAt}",
  "task.created.cron": "Cron: {cron}",
  "task.button.retry_schedule": "🔁 일정 다시 입력",
  "task.button.cancel": "❌ 취소",
  "task.retry_schedule_callback": "일정을 다시 입력하는 중...",
  "task.inactive_callback": "이 예약 작업 흐름은 비활성 상태입니다",
  "task.inactive": "⚠️ 예약 작업 생성이 활성 상태가 아닙니다. /task를 다시 실행해 주세요.",
  "task.blocked.expected_input":
    "⚠️ 텍스트를 보내거나 일정 메시지의 버튼을 사용하여 현재 예약 작업 설정을 먼저 마쳐 주세요.",
  "task.blocked.command_not_allowed":
    "⚠️ 예약 작업 생성이 진행 중인 동안에는 이 명령어를 사용할 수 없습니다.",
  "task.limit_reached":
    "⚠️ 작업 개수 한도에 도달했습니다 ({limit}). 먼저 기존 예약 작업을 삭제해 주세요.",
  "task.schedule_too_frequent":
    "반복 일정이 너무 잦습니다. 허용되는 최소 간격은 5분마다 한 번입니다.",
  "task.kind.cron": "반복",
  "task.kind.once": "1회성",
  "task.run.success": "⏰ 예약 작업 완료: {description}",
  "task.run.error": "🔴 예약 작업 실패: {description}\n\n오류: {error}",
  "task.run.error.folder_missing": "The project folder no longer exists: {path}",
  "task.run.error.interactive_question":
    "예약 작업이 대화형 질문을 요청하여 무인 실행을 계속할 수 없습니다.",
  "task.run.error.interactive_permission":
    "예약 작업이 대화형 권한 승인을 요청하여 무인 실행을 계속할 수 없습니다.",

  "commands.download.not_file": "경로가 파일이 아닙니다",
  "cmd.description.rename": "현재 세션 이름 변경",

  "cmd.description.open": "디렉터리를 탐색하여 프로젝트 추가",
  "open.no_subfolders": "📭 하위 폴더 없음",
  "open.subfolder_count": "하위 폴더 {count}개",
  "open.subfolders_count": "하위 폴더 {count}개",
  "ls.access_denied": "⛔ 접근이 거부되었습니다: 현재 프로젝트 밖의 경로입니다",
  "ls.scan_error": "🔴 디렉터리를 조회할 수 없습니다",
  "local_command.empty_output": "The command produced no output.",
  "local_command.failed": "Command failed with exit code {exitCode}: {stderr}",
  "local_command.timeout": "The command timed out.",
  "cmd.description.models": "Browse models",
  "cmd.description.model": "Select provider/model",
  "cmd.description.agent": "Select agent",
  "cmd.description.variant": "Select reasoning variant",
  "cmd.description.compact": "Compact session context",
  "cmd.description.download": "Download a local file",
  "cmd.description.attach": "Attach a local text file",
  "cmd.description.permission": "Answer a permission request",
  "cmd.description.answer": "Answer OpenCode questions",
  "cmd.description.cancel": "Reject pending questions",
  "cmd.description.context": "Inspect session token usage",
  "cmd.description.revert": "Revert to a user message",
  "cmd.description.fork": "Fork the current session",
};

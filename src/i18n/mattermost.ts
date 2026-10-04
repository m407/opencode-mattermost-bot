/** English fallback for the native Mattermost interface. */
export const mattermost = {
  "mattermost.bot.processing": "Processing…",
  "mattermost.bot.operation_failed": "Operation failed: {value1}",
  "mattermost.bot.this_message_arrived_after_an_outage_and_was_not_execut":
    "This message arrived after an outage and was not executed. Send it again to continue.",
  "mattermost.bot.choose_a_project_with_projects_or_open_path_first":
    "Choose a project with !projects or !open <path> first.",
  "mattermost.bot.create_or_select_a_session_with_new_or_sessions":
    "Create or select a session with !new or !sessions.",
  "mattermost.bot.the_session_is_busy_use_abort_or_detach_first":
    "The session is busy. Use !abort or !detach first.",
  "mattermost.bot.project_use_new_to_create_a_session":
    "Project: **{value1}**\n`{value2}`\nUse !new to create a session.",
  "mattermost.bot.opencode_mattermost_bot_send_a_message_to_run_a_task_co":
    "**OpenCode Mattermost Bot**\nSend a message to run a task. Commands use `!`, or `/opencode` when configured.\n\n{value1}\n\n{value2}",
  "mattermost.bot.opencode_mattermost_bot_server_project_session_agent_mo":
    "**OpenCode Mattermost Bot {value1}**\nServer: {value2} ({value3})\nProject: {value4}\nSession: {value5}\nAgent: {value6}\nModel: {value7}/{value8} ({value9})\nState: {value10}\nQueued: {value11}",
  "mattermost.bot.could_not_create_session": "Could not create session.",
  "mattermost.bot.session_created": "Session created: **{value1}**",
  "mattermost.bot.task_stopped_queued_prompts_cleared": "Task stopped; queued prompts cleared.",
  "mattermost.bot.detached_local_queued_prompts_cleared_the_opencode_task":
    "Detached; local queued prompts cleared. The OpenCode task continues on the server.",
  "mattermost.bot.project_not_found": "Project not found.",
  "mattermost.bot.projects": "Projects",
  "mattermost.bot.use_open_project_directory": "Use !open <project directory>.",
  "mattermost.bot.session_not_found": "Session not found.",
  "mattermost.bot.following": "Following **{value1}**{value2}",
  "mattermost.bot.sessions": "Sessions",
  "mattermost.bot.use_the_session_list_to_select_a_session":
    "Use the session list to select a session.",
  "mattermost.bot.following_20": "Following **{value1}**",
  "mattermost.bot.use_rename_title": "Use !rename <title>.",
  "mattermost.bot.session_renamed": "Session renamed: {value1}",
  "mattermost.bot.models": "Models",
  "mattermost.bot.use_model_provider_model": "Use !model <provider/model>.",
  "mattermost.bot.model_is_not_available": "Model is not available.",
  "mattermost.bot.model": "Model: {value1}",
  "mattermost.bot.agents": "Agents",
  "mattermost.bot.unknown_agent": "Unknown agent.",
  "mattermost.bot.agent": "Agent: {value1}",
  "mattermost.bot.variants": "Variants",
  "mattermost.bot.unknown_variant": "Unknown variant.",
  "mattermost.bot.variant": "Variant: {value1}",
  "mattermost.bot.context_model_tokens_cost":
    "**Context**\nModel: {value1}/{value2}\nTokens: {value3}\nCost: {value4}",
  "mattermost.bot.no_assistant_usage_yet": "No assistant usage yet.",
  "mattermost.bot.use_messages_to_find_a_message_id_then_revert_message_i":
    "Use !messages to find a message ID, then !revert <message ID>.",
  "mattermost.bot.session_reverted_send_the_replacement_prompt":
    "Session reverted. Send the replacement prompt.",
  "mattermost.bot.could_not_fork_session": "Could not fork session.",
  "mattermost.bot.following_fork": "Following fork: {value1}",
  "mattermost.bot.recent_prompts_latest_response":
    "**Recent prompts**\n{value1}\n\n**Latest response**\n{value2}",
  "mattermost.bot.use_mcps_name_on_off": "Use !mcps <name> on|off.",
  "mattermost.bot.mcp_servers": "MCP servers",
  "mattermost.bot.the_project_is_not_a_git_worktree": "The project is not a Git worktree.",
  "mattermost.bot.worktrees": "Worktrees",
  "mattermost.bot.session_compacted": "Session compacted.",
  "mattermost.bot.opencode_configuration_reloaded": "OpenCode configuration reloaded.",
  "mattermost.bot.process_management_is_only_available_for_a_local_openco":
    "Process management is only available for a local OpenCode server.",
  "mattermost.bot.could_not_stop_opencode": "Could not stop OpenCode.",
  "mattermost.bot.opencode_stopped": "OpenCode stopped.",
  "mattermost.bot.opencode_is_already_running": "OpenCode is already running.",
  "mattermost.bot.opencode_cannot_be_started_see_the_bot_logs":
    "OpenCode cannot be started. See the bot logs.",
  "mattermost.bot.opencode_startup_requested": "OpenCode startup requested.",
  "mattermost.bot.local_command": "Local command: {value1}",
  "mattermost.bot.no_entries": "{value1}: no entries.",
  "mattermost.bot.settings": "Settings",
  "mattermost.bot.queue": "Queue: {value1}",
  "mattermost.bot.audio": "Audio: {value1}",
  "mattermost.bot.invalid_setting_use_settings_to_list_available_choices":
    "Invalid setting. Use !settings to list available choices.",
  "mattermost.bot.setting_updated": "Setting updated: {value1} = {value2}",
  "mattermost.bot.path_is_outside_the_configured_browser_roots":
    "Path is outside the configured browser roots.",
  "mattermost.bot.use_ls_directory_download_file_or_attach_file":
    "`{value1}`\n{value2}\nUse !ls <directory>, !download <file>, or !attach <file>.",
  "mattermost.bot.file_is_not_a_regular_file_or_exceeds_code_file_max_siz":
    "File is not a regular file or exceeds CODE_FILE_MAX_SIZE_KB.",
  "mattermost.bot.at_most_local_files_may_be_attached_to_the_next_prompt":
    "At most 10 local files may be attached to the next prompt.",
  "mattermost.bot.use_a_mattermost_upload_for_images_and_binary_documents":
    "Use a Mattermost upload for images and binary documents.",
  "mattermost.bot.attached_to_your_next_prompt": "Attached to your next prompt: {value1}",
  "mattermost.bot.scheduled_tasks": "Scheduled tasks",
  "mattermost.bot.use_task_schedule_prompt": "Use !task <schedule> | <prompt>.",
  "mattermost.bot.scheduled_task_limit_reached": "Scheduled task limit reached.",
  "mattermost.bot.scheduled_next_run": "Scheduled: {value1}\nNext run: {value2}",
  "mattermost.bot.at_most_files_can_be_included_in_a_prompt":
    "At most 10 files can be included in a prompt.",
  "mattermost.bot.prompt_files_exceed_the_mib_limit": "Prompt files exceed the 20 MiB limit.",
  "mattermost.bot.unsupported_file_type_configure_doc_extractor_url_for_d":
    "Unsupported file type: {value1}. Configure DOC_EXTRACTOR_URL for document extraction.",
  "mattermost.bot.configure_stt_api_url_and_stt_api_key_to_transcribe_aud":
    "Configure STT_API_URL and STT_API_KEY to transcribe audio.",
  "mattermost.bot.the_prompt_is_empty": "The prompt is empty.",
  "mattermost.bot.the_session_is_busy_enable_settings_queue_queue_or_use_":
    "The session is busy; enable !settings queue queue or use !abort.",
  "mattermost.bot.steering_message_submitted_to_the_running_session":
    "Steering message submitted to the running session.",
  "mattermost.bot.the_prompt_queue_is_full_prompts": "The prompt queue is full (5 prompts).",
  "mattermost.bot.queued_prompt": "Queued prompt {value1}/5.",
  "mattermost.bot.unknown_command_use_help": "Unknown command: {value1}. Use !help.",
  "mattermost.bot.opencode_command_failed_check_the_server_logs":
    "OpenCode command failed. Check the server logs.",
  "mattermost.bot.the_queued_prompt_could_not_be_submitted_send_it_again_":
    "The queued prompt could not be submitted. Send it again to retry.",
  "mattermost.bot.opencode_project_session":
    "**OpenCode**\nProject: {value1}\nSession: {value2}\n{value3} · {value4}/{value5} ({value6})\n{value7}",
  "mattermost.activity.follow_session": "Follow session",
  "mattermost.activity.opencode_could_not_finish_the_task_check_the_server_log":
    "OpenCode could not finish the task. Check the server logs.",
  "mattermost.activity.settled_in_opencode": "Settled in OpenCode",
  "mattermost.interactions.permission_permission_once_always_reject":
    "**Permission: {value1}**\n{value2}\n\n`!permission {value3} once|always|reject`",
  "mattermost.interactions.opencode_question_answer_every_question_in_order_answer":
    '**OpenCode question**\n{value1}\n\nAnswer every question in order: `!answer {value2} [["answer"]]`\nCancel: `!cancel {value3}`',
  "mattermost.interactions.cancel": "Cancel",
  "mattermost.interactions.no_longer_followed": "{value1}\n\nNo longer followed",
  "mattermost.interactions.this_request_is_no_longer_pending_in_this_thread":
    "This request is no longer pending in this thread.",
  "mattermost.interactions.supply_one_answer_array_per_question":
    "Supply one answer array per question.",
  "mattermost.interactions.invalid_question_answer": "Invalid question answer.",
  "mattermost.interactions.custom_answers_are_not_allowed_for_this_question":
    "Custom answers are not allowed for this question.",
  "mattermost.interactions.choose_once_always_or_reject": "Choose once, always, or reject.",
  "mattermost.interactions.cancelled": "Cancelled",
  "mattermost.interactions.answered": "Answered",
} as const;

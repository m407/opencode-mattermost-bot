# Localization

`src/i18n/en.ts` defines the translation keys and `I18nDictionary`. Other dictionaries preserve the same keys and placeholders. Register a new dictionary and its locale/date locale in `src/i18n/index.ts`.

Use `t(key, parameters)` for user-facing text. Keep Mattermost Markdown and command syntax intact. Do not translate command names, request IDs or option values sent back to OpenCode. Set `BOT_LOCALE` to select a language. Command descriptions, runtime/service messages, scheduling and shared formatters use the central dictionaries.

After changes, run `npm run typecheck`, `npm run lint`, and `npm test`. `tests/i18n/placeholders.test.ts` checks placeholder parity. New Mattermost-specific strings should use the same translation structure; untranslated entries may use the English fallback until localized.

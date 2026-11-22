# Contributing

Keep changes focused on the ApproveLink MVP workflows. The app uses Node's built-in HTTP server and SQLite API; avoid adding dependencies unless a listed workflow cannot reasonably work without one.

## Development

```sh
npm install
npm run dev
```

The server reads `PORT`, `DB_PATH`, and `PUBLIC_ORIGIN`. Tests use isolated temporary SQLite files and do not touch a developer database.

## Before submitting

```sh
npm test
```

Add coverage for new status transitions and validation rules. Preserve parameterized SQL, unguessable reviewer tokens, token-scoped lookups, and the audit event history. Do not put client data or secrets in logs or fixtures.

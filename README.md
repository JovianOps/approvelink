# ApproveLink

ApproveLink gives freelancers one private link for a client to approve a milestone or send categorized revision notes. Reviewers do not need an account. Requests and their audit timeline persist in a local SQLite database.

## Run locally

Requires Node.js 22.13 or newer (uses the built-in `node:sqlite` module).

```sh
npm start
```

Open [http://localhost:3000](http://localhost:3000). Set `PORT` to change the port, `DB_PATH` to choose the SQLite file, and `PUBLIC_ORIGIN` when generating links from a hosted deployment. The default database is `approvelink.sqlite` in the project folder. Back it up with the server stopped, or copy the database and its `-wal` / `-shm` files while it is running.

## Verify

```sh
npm test
```

The suite covers health, creation, approval, categorized revision requests, validation, expiry, reapproval, and persistence. This MVP has no creator sign-in: anyone with local access to the dashboard can view or manage its requests. Treat the database and creator dashboard as private. Client links use unguessable random tokens; only share a link with its intended reviewer.

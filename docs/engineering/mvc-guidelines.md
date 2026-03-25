# MVC Guidelines

1. Views do not contain business logic.
2. Controllers are thin and translate UI/API intents into service calls.
3. Services hold reusable domain logic and orchestration.
4. Repositories hide persistence and external API details.
5. Data sources communicate with local DBs or remote APIs only.
6. Generate real task/project instances ahead of time; do not compute all recurrence dynamically at render time.

# Intelligent Emergency Response & Resource Optimization Platform

A backend API for coordinating emergency response operations, optimizing resource allocation, and supporting real-time decision-making during crisis events.

## Technologies

- **Runtime**: Node.js
- **Language**: TypeScript (strict mode)
- **Framework**: Express.js
- **Database**: PostgreSQL
- **ORM**: Prisma
- **Environment**: dotenv
- **HTTP Status Codes**: http-status

---

## Project Structure

```
project-root/
│
├── src/
│   ├── app.ts                  # Express app setup (middleware, routes)
│   ├── index.ts                # Server entry point
│   │
│   ├── config/
│   │   └── index.ts            # Centralized environment configuration
│   │
│   ├── lib/
│   │   └── prisma.ts           # Reusable PrismaClient singleton
│   │
│   ├── middlewares/
│   │   └── errorHandler.ts     # Global error handling middleware
│   │
│   └── utils/
│       └── errors.ts           # AppError class for operational errors
│
├── prisma/
│   └── schema.prisma           # Prisma schema (PostgreSQL)
│
├── .env                        # Local environment variables (git-ignored)
├── .env.example                # Environment variable template
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

---

## Installation

### 1. Clone the repository

```bash
git clone <repository-url>
cd project-root
```

### 2. Install dependencies

```bash
npm install
```

---

## Environment Configuration

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env`:

```env
PORT=5000
DATABASE_URL="postgresql://username:password@localhost:5432/emergency_response"
JWT_SECRET="change_this_secret"
JWT_EXPIRES_IN="7d"
```

> **Note:** `JWT_SECRET` and `JWT_EXPIRES_IN` are configuration placeholders. Authentication is not implemented in this part.

---

## Prisma Setup

Generate the Prisma client after installing dependencies:

```bash
npx prisma generate
```

When domain models are added and you need to run migrations:

```bash
npm run prisma:migrate
```

To browse the database visually:

```bash
npm run prisma:studio
```

---

## Development Commands

| Command | Description |
|---|---|
| `npm run dev` | Start development server with hot-reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled production build |
| `npm run prisma:generate` | Generate Prisma client |
| `npm run prisma:migrate` | Run database migrations |
| `npm run prisma:studio` | Open Prisma Studio |

---

## Health Check Endpoint

**Request**

```
GET http://localhost:5000/health
```

**Response**

```json
{
  "success": true,
  "message": "Emergency Response API is running"
}
```

---

## Common Setup Errors

| Error | Cause | Fix |
|---|---|---|
| `Port 5000 is already in use` | Another process is on port 5000 | Change `PORT` in `.env` or stop the other process |
| `Cannot find module '@prisma/client'` | Prisma client not generated | Run `npx prisma generate` |
| `Error: DATABASE_URL is not set` | Missing `.env` file | Copy `.env.example` to `.env` and fill in values |
| `ECONNREFUSED` on DB connect | PostgreSQL not running | Start your PostgreSQL server |
| TypeScript compile errors | Outdated `dist/` | Run `npm run build` again |

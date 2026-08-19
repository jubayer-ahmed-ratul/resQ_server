# 🚨 ResQ — Intelligent Emergency Response & Resource Optimization Platform

A production-grade backend API for coordinating emergency response operations in real time. Built for the hackathon, ResQ handles incident reporting, AI-driven resource allocation, automated re-optimization, and full audit trails — all designed to scale.

---

## 🌐 Live Demo

| Service | URL |
|---|---|
| API (Production) | `https://resq-server.onrender.com` |
| Health Check | `https://resq-server.onrender.com/health` |
| Readiness | `https://resq-server.onrender.com/ready` |

---

## ✨ Key Features

- **AI Resource Allocation Engine** — Haversine-based GPS distance scoring, ETA ranking, capacity filtering, and fully explainable decisions
- **Event-Driven Architecture** — Outbox pattern guarantees zero event loss even when the queue is down
- **Auto Re-optimization** — When a resource fails mid-mission, the system automatically finds a replacement
- **Role-Based Access Control** — 4 roles: `ADMIN`, `COORDINATOR`, `OPERATOR`, `CITIZEN`
- **Redis Caching** — Hospital and resource list endpoints cached with 5-minute TTL
- **Idempotency** — Duplicate POST requests are safely replayed, never double-processed
- **Distributed Rate Limiting** — Redis-backed, shared across all API instances
- **Full Audit Logging** — Every sensitive action is recorded with actor, IP, and timestamp
- **Horizontally Scalable** — Stateless API, shared PostgreSQL + Redis, independent worker processes
- **13 Unit Tests** — Full coverage of the allocation engine edge cases

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 |
| Language | TypeScript (strict mode) |
| Framework | Express.js |
| Database | PostgreSQL (Neon) |
| ORM | Prisma |
| Cache | Redis (Upstash) |
| Queue | BullMQ (Redis-backed) |
| Auth | JWT (Bearer token) |
| Validation | Zod |
| Security | Helmet, bcrypt, rate limiting |
| Deployment | Render |
| Load Testing | k6 |

---

## 🏗 Architecture

```
                         CLIENTS
                           │
                           ▼
                    LOAD BALANCER
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
        API-1            API-2            API-3
    (stateless)      (stateless)      (stateless)
          │                │                │
          └────────┬────────────────┬───────┘
                   │                │
                   ▼                ▼
             PostgreSQL           Redis
          (source of truth)  (cache + queue)
                                    │
                               BullMQ Queue
                                    │
                     ┌──────────────┼──────────────┐
                     ▼              ▼              ▼
                  Worker-1       Worker-2       Worker-3
                                    │
                             Outbox Poller
                         (PENDING → PUBLISHED)
```

**Design principles:**
- PostgreSQL is the single source of truth for all business state
- Redis handles: cache (TTL-bound), BullMQ queue state, distributed rate-limit counters
- API instances are fully stateless — any instance handles any request
- Workers are independently scalable from the API

---

## 📁 Project Structure

```
src/
├── app.ts                          ← Express setup (middleware, routes)
├── index.ts                        ← Server entry point (unified API + Worker)
│
├── auth/                           ← JWT login, register, profile
├── cache/                          ← Redis cache service (cache-aside pattern)
├── config/                         ← Centralized env config + validation
├── events/
│   ├── handlers/                   ← Domain event handlers (10 event types)
│   └── outbox/                     ← Outbox publisher (reliable event delivery)
├── health/                         ← Liveness + readiness endpoints
├── lib/                            ← Logger, Prisma singleton, cleanup scheduler
├── middlewares/                    ← Auth, RBAC, rate limit, validate, error handler
├── modules/
│   ├── assignment/                 ← Resource ↔ Incident assignment
│   ├── audit/                      ← Audit log reader
│   ├── decision/                   ← AI allocation engine + decision logs
│   ├── hospital/                   ← Hospital CRUD + availability
│   ├── incident/                   ← Incident lifecycle management
│   ├── reoptimization/             ← Re-optimization trigger + logs
│   ├── resource/                   ← Resource CRUD + status management
│   └── user/                       ← User management (ADMIN only)
├── queue/                          ← BullMQ queue service
└── workers/                        ← Event worker (processes domain events)

prisma/
└── schema.prisma                   ← 11 models, enums, indexes

load-tests/
├── scenarios.js                    ← Shared helpers, thresholds, data generators
├── health.js                       ← Liveness + readiness load test
├── incidents.js                    ← Incident CRUD load test
├── assignments.js                  ← Concurrent assignment test
├── reoptimization.js               ← Resource failure + re-optimization test
├── spike.js                        ← Sudden traffic spike test
└── soak.js                         ← 30-minute sustained load test
```

---

## 🔑 Roles & Permissions

| Action | ADMIN | COORDINATOR | OPERATOR | CITIZEN |
|---|:---:|:---:|:---:|:---:|
| Create incident | ✅ | ✅ | ✅ | ✅ |
| Validate / update incident | ✅ | ✅ | ❌ | ❌ |
| Manage resources | ✅ | ❌ | Own only | ❌ |
| Manage hospitals | ✅ | ❌ | Own only | ❌ |
| Create assignments | ✅ | ✅ | ❌ | ❌ |
| Trigger re-optimization | ✅ | ✅ | ❌ | ❌ |
| View audit logs | ✅ | ✅ | ❌ | ❌ |
| Manage users | ✅ | ❌ | ❌ | ❌ |

> **Note:** `OPERATOR` can only update status/location of resources and capacity/status of hospitals that are explicitly assigned to them by an `ADMIN`.

---

## 📡 API Endpoints

### Auth
| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | `/api/auth/register` | Public | Register (CITIZEN only) |
| POST | `/api/auth/login` | Public | Login, returns JWT |
| GET | `/api/auth/me` | All | Get current user |
| PATCH | `/api/auth/me` | All | Update own profile |

### Incidents
| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | `/api/incidents` | All auth | Create incident |
| GET | `/api/incidents` | All auth | List with pagination + filters |
| GET | `/api/incidents/:id` | All auth | Get single incident |
| PATCH | `/api/incidents/:id/validate` | ADMIN/COORDINATOR | Validate incident |
| PATCH | `/api/incidents/:id/status` | ADMIN/COORDINATOR | Update status |

### Resources
| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | `/api/resources` | ADMIN | Create resource |
| GET | `/api/resources` | All auth | List (OPERATOR sees own only) |
| GET | `/api/resources/:id` | All auth | Get single resource |
| PATCH | `/api/resources/:id` | ADMIN/OPERATOR | Update resource |
| DELETE | `/api/resources/:id` | ADMIN | Deactivate resource |
| POST | `/api/resources/:id/assign-operator` | ADMIN | Assign operator |
| DELETE | `/api/resources/:id/operator` | ADMIN | Remove operator |

### Hospitals
| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | `/api/hospitals` | ADMIN | Create hospital |
| GET | `/api/hospitals` | All auth | List hospitals |
| GET | `/api/hospitals/:id` | All auth | Get hospital |
| GET | `/api/hospitals/:id/availability` | All auth | Bed/ICU availability |
| PATCH | `/api/hospitals/:id` | ADMIN/OPERATOR | Update hospital |
| DELETE | `/api/hospitals/:id` | ADMIN | Deactivate (CLOSED) |
| POST | `/api/hospitals/:id/assign-operator` | ADMIN | Assign operator |
| DELETE | `/api/hospitals/:id/operator` | ADMIN | Remove operator |

### Assignments
| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | `/api/assignments` | ADMIN/COORDINATOR | Create assignment |
| GET | `/api/assignments` | All auth | List assignments |
| PATCH | `/api/assignments/:id/complete` | ADMIN/COORDINATOR | Complete assignment |
| PATCH | `/api/assignments/:id/cancel` | ADMIN/COORDINATOR | Cancel assignment |

### Decisions & Re-optimization
| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/api/decisions` | ADMIN/COORDINATOR | List decision logs |
| GET | `/api/decisions/:incidentId` | ADMIN/COORDINATOR | Decisions for incident |
| POST | `/api/reoptimizations/:incidentId` | ADMIN/COORDINATOR | Trigger re-optimization |
| GET | `/api/reoptimizations` | ADMIN/COORDINATOR | List re-optimization logs |

### Users & Audit
| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | `/api/users` | ADMIN | Create user (any role) |
| GET | `/api/users` | ADMIN | List users |
| PATCH | `/api/users/:id` | ADMIN | Update user |
| POST | `/api/users/:id/deactivate` | ADMIN | Deactivate user |
| POST | `/api/users/:id/activate` | ADMIN | Activate user |
| GET | `/api/audit-logs` | ADMIN/COORDINATOR | List audit logs |

### Health
| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Liveness — always returns `ok` if process is alive |
| GET | `/ready` | Readiness — checks PostgreSQL + Redis + Cache |

---

## 🧠 Resource Allocation Engine

The core algorithm selects the optimal resource for an incident in 3 steps:

**Step 1 — Filter (hard constraints)**
```
✅ status === 'AVAILABLE'
✅ type matches incident requirements
✅ capacity >= affectedPeople
```

**Step 2 — Score (Haversine distance + ETA)**
```
distance = haversineDistanceKm(incident.lat, incident.lon, resource.lat, resource.lon)
ETA      = (distance / averageSpeedKmh) × 60  (minutes)
```

**Step 3 — Rank (deterministic)**
```
1. Lowest ETA              (minimize response time)
2. Lowest capacity surplus (best fit — avoid waste)
3. Lexicographic ID        (stable tie-breaker)
```

Every decision is stored in `DecisionLog` with full explanation — rejected candidates, reasons, and algorithm version.

---

## ⚡ Event System

10 domain events power the async workflow:

```
INCIDENT_CREATED         → triggers priority calculation
PRIORITY_CALCULATED      → updates incident priority score
RESOURCE_STATUS_CHANGED  → triggers re-optimization check
RESOURCE_FAILURE_DETECTED→ triggers immediate re-optimization
ASSIGNMENT_CREATED       → logs audit, updates resource to BUSY
ASSIGNMENT_COMPLETED     → releases resource back to AVAILABLE
ASSIGNMENT_CANCELLED     → releases resource back to AVAILABLE
REOPTIMIZATION_REQUESTED → starts replacement resource search
REOPTIMIZATION_COMPLETED → logs result
```

**Outbox guarantee:** Events are written inside the same DB transaction as the business operation. A background poller publishes them to BullMQ every 5 seconds. Redis downtime only causes a delay — events are never lost.

---

## 🚀 Local Setup

### Prerequisites
- Node.js 20+
- PostgreSQL
- Redis (or use Upstash free tier)

### 1. Clone & Install
```bash
git clone https://github.com/jubayer-ahmed-ratul/resQ_server.git
cd resQ_server
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
```

Edit `.env` with your values:
```env
PORT=5000
NODE_ENV=development

DATABASE_URL="postgresql://user:password@localhost:5432/resq"
JWT_SECRET="your-secret-min-32-chars"

REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=

CORS_ORIGINS=http://localhost:3000
```

### 3. Run Migrations & Generate Client
```bash
npx prisma migrate dev
npx prisma generate
```

### 4. Start Development Server
```bash
npm run dev
```

Server starts at `http://localhost:5000`

---

## 🧪 Running Tests

### Unit Tests
```bash
npm test
```
13 tests covering the resource allocation engine — distance calculation, ETA, type matching, capacity filtering, tie-breaking, determinism, and result structure.

### Load Tests (requires k6)

Install k6: `winget install k6 --source winget`

```bash
# Health endpoints
k6 run load-tests/health.js

# Incident CRUD (requires auth)
k6 run -e LOAD_TEST_EMAIL=admin@example.com \
        -e LOAD_TEST_PASSWORD=yourpassword \
        load-tests/incidents.js

# Concurrent assignment test
k6 run -e LOAD_TEST_EMAIL=admin@example.com \
        -e LOAD_TEST_PASSWORD=yourpassword \
        load-tests/assignments.js

# Spike test
k6 run -e LOAD_TEST_EMAIL=admin@example.com \
        -e LOAD_TEST_PASSWORD=yourpassword \
        load-tests/spike.js

# 30-minute soak test
k6 run -e LOAD_TEST_EMAIL=admin@example.com \
        -e LOAD_TEST_PASSWORD=yourpassword \
        load-tests/soak.js
```

---

## 🌱 Creating Users

Self-registration creates `CITIZEN` accounts only. All other roles must be created by an `ADMIN`:

```http
POST /api/users
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "name": "Rahim Coordinator",
  "email": "rahim@resq.com",
  "password": "securepassword",
  "role": "COORDINATOR"
}
```

Available roles: `ADMIN` | `COORDINATOR` | `OPERATOR` | `CITIZEN`

---

## 📊 Scalability

| Layer | Mechanism | Status |
|---|---|---|
| API | Stateless — horizontally scalable | ✅ |
| Rate Limiting | Redis-backed distributed (fallback: in-process) | ✅ |
| Caching | Redis cache-aside, 5-min TTL, pattern invalidation | ✅ |
| Pagination | All list endpoints paginated (max 100) | ✅ |
| Database | Indexes on `status`, `type`, `priorityScore`, `createdAt` | ✅ |
| Queue | BullMQ multi-worker, configurable concurrency | ✅ |
| Health/Ready | Liveness + readiness for load balancer routing | ✅ |
| Graceful Shutdown | Queue + cache + DB closed cleanly on SIGTERM | ✅ |

---

## 🔧 Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run production build (API only) |
| `npm run worker` | Run worker process separately |
| `npm test` | Run unit tests |
| `npm run prisma:migrate` | Run database migrations |
| `npm run prisma:generate` | Generate Prisma client |
| `npm run prisma:studio` | Open Prisma Studio (DB browser) |
| `npm run load:health` | k6 health load test |
| `npm run load:test` | k6 incident load test |
| `npm run load:spike` | k6 spike test |
| `npm run load:soak` | k6 30-minute soak test |

---

## 🔒 Security

- **Helmet** — sets secure HTTP headers on every response
- **JWT** — stateless authentication, 7-day expiry
- **bcrypt** — passwords hashed with 12 salt rounds
- **Zod validation** — all request bodies validated at the route level
- **Idempotency Keys** — prevents duplicate POST requests from double-processing
- **Request ID** — every request gets a unique ID for tracing
- **Rate Limiting** — 100 req/min general, stricter on auth endpoints
- **CORS** — configurable origin whitelist via `CORS_ORIGINS`
- **Timing-safe login** — dummy hash comparison prevents email enumeration

---

## 📄 License

MIT

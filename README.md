# AI Teaching Assistant

🎓 An AI-powered platform for teachers to generate teaching materials from lesson outlines.

## Features

- 📊 **PPTX Generation** - Create PowerPoint slides with speaker notes
- 📄 **Handout Generation** - Generate study materials in Word format
- ❓ **Quiz Generation** - Create multiple-choice quizzes (Excel/Word)
- 🔊 **TTS Integration** - Multiple text-to-speech providers
- 🔐 **Role-based Auth** - Admin and User roles with JWT

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite
- **Backend**: NestJS, Prisma, PostgreSQL
- **AI**: Google Gemini 1.5 Flash
- **Storage**: MinIO (S3-compatible)
- **Cache**: Redis

## Quick Start

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- Gemini API Key

### Development

```bash
# Clone repository
git clone <repo-url>
cd ai-teaching-assistant

# Backend
cd backend
npm install
cp .env.example .env  # Edit with your values
npx prisma migrate dev
npm run start:dev

# Frontend (new terminal)
cd frontend
npm install
npm run dev
```

### Production (Docker)

```bash
# Configure environment
cp .env.example .env
# Edit .env with production values

# Deploy
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `POSTGRES_PASSWORD` | Database password | ✅ |
| `JWT_SECRET` | JWT signing key (32+ chars) | ✅ |
| `ENCRYPTION_KEY` | Encryption key (32 chars) | ✅ |
| `GEMINI_API_KEY` | Google Gemini API key | ✅ |
| `MINIO_ROOT_PASSWORD` | MinIO admin password | ✅ |

## Project Structure

```
ai-teaching-assistant/
├── backend/                 # NestJS API
│   ├── src/
│   │   ├── auth/           # JWT authentication
│   │   ├── prompts/        # AI prompt management
│   │   ├── subjects/       # Subject CRUD
│   │   ├── lessons/        # Lesson management
│   │   ├── ai/             # Gemini integration
│   │   ├── export/         # PPTX/DOCX/Excel generation
│   │   ├── tts/            # Text-to-speech
│   │   └── generation/     # Content orchestration
│   └── prisma/             # Database schema
├── frontend/               # React SPA
│   └── src/
│       ├── pages/          # Route components
│       ├── contexts/       # React contexts
│       └── lib/            # API client
└── docker-compose.prod.yml # Production deployment
```

## API Endpoints

### Authentication
- `POST /auth/register` - Create account
- `POST /auth/login` - Get tokens
- `POST /auth/refresh` - Refresh tokens

### Subjects & Lessons
- `GET/POST /subjects` - Manage subjects
- `GET/POST /subjects/:id/lessons` - Manage lessons
- `POST /lessons/:id/upload-outline` - Upload outline file
- `POST /lessons/:id/generate` - Start content generation

### Admin
- `GET/POST /admin/prompts` - Manage AI prompts
- `GET/POST /admin/tts-providers` - Manage TTS providers

## License

MIT

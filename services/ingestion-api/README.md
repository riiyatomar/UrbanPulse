# UrbanPulse Ingestion API

FastAPI service that receives civic infrastructure complaint images, applies privacy blurring, stores to S3-compatible storage, and queues detection jobs for asynchronous processing.

## Architecture

```
Client (Mobile/CCTV/Drone)
    │
    ▼
POST /api/v1/complaints  (image + optional GPS/timestamp)
    │
    ├─ 1. Validate image (format, size, integrity)
    ├─ 2. Extract EXIF GPS/timestamp if not in body
    ├─ 3. Blur faces + license plates
    ├─ 4. Upload to S3: originals/ + blurred/
    ├─ 5. INSERT INTO complaints (status='pending')
    ├─ 6. Publish detection job → Redis queue
    │
    ▼
Return {id, status, image_url, created_at}  ← immediate, non-blocking
```

## API Endpoints

### `POST /api/v1/complaints`

Submit a new civic infrastructure complaint.

**Request** (multipart/form-data):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `image` | File | ✅ | Image file (JPEG, PNG, WEBP, TIFF) |
| `lat` | float | ❌* | GPS latitude (-90 to 90) |
| `lng` | float | ❌* | GPS longitude (-180 to 180) |
| `timestamp` | string | ❌ | Capture time (ISO 8601) |
| `source` | string | ❌ | `mobile_app` (default), `cctv`, `drone` |

*GPS is required — must come from either form data or image EXIF.

**Response** (201):
```json
{
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "pending",
    "image_url": "http://localhost:9000/urbanpulse-images/blurred/550e84.jpg",
    "created_at": "2024-01-15T10:30:00Z",
    "message": "Complaint submitted successfully. Detection in progress."
}
```

**Error Responses**:
- `422`: Missing GPS, corrupt image, invalid source
- `413`: Image exceeds size limit (20MB)

### `GET /health`

Service health check. Returns `{"status": "healthy"}`.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/urbanpulse` | PostgreSQL connection |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis queue connection |
| `S3_ENDPOINT` | `http://localhost:9000` | S3/MinIO endpoint |
| `S3_BUCKET` | `urbanpulse-images` | Image bucket name |
| `S3_ACCESS_KEY` | `minioadmin` | S3 access key |
| `S3_SECRET_KEY` | `minioadmin` | S3 secret key |
| `MAX_IMAGE_SIZE_MB` | `20` | Max upload size |
| `BLUR_ENABLED` | `true` | Enable privacy blur |
| `BLUR_MODE` | `stub` | `stub` (dev) or `model` (production) |

## Local Development

### Prerequisites

- Python 3.11+
- PostgreSQL with UrbanPulse schema applied (see `infra/migrations/`)
- Redis (for job queue)
- MinIO (for S3-compatible storage)

### Setup

```bash
cd services/ingestion-api

# Create virtual environment
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows

# Install dependencies
pip install -r requirements.txt

# Start the server
uvicorn app.main:app --reload --port 8001
```

### Quick Test

```bash
curl -X POST http://localhost:8001/api/v1/complaints \
  -F "image=@path/to/photo.jpg" \
  -F "lat=28.6139" \
  -F "lng=77.2090" \
  -F "source=mobile_app"
```

## Running Tests

```bash
cd services/ingestion-api
pytest tests/ -v
```

Tests use mocked dependencies — no external services required:
- Database → `MagicMock`
- S3 storage → `MagicMock`
- Redis queue → `MagicMock`
- Blur service → pass-through mock

## File Structure

```
ingestion-api/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI app + lifespan
│   ├── config.py             # Pydantic settings
│   ├── models.py             # Request/response schemas
│   ├── routes/
│   │   ├── __init__.py
│   │   └── complaints.py     # POST /complaints
│   └── services/
│       ├── __init__.py
│       ├── blur.py            # Face/plate blur pipeline
│       ├── database.py        # PostgreSQL operations
│       ├── queue.py           # Redis queue publisher
│       └── storage.py         # S3/MinIO storage
├── tests/
│   ├── __init__.py
│   ├── conftest.py            # Test fixtures + mocks
│   ├── test_complaints.py     # API endpoint tests
│   ├── test_blur.py           # Blur pipeline tests
│   └── test_storage.py        # Storage service tests
├── Dockerfile
├── requirements.txt
└── README.md
```

1. Start Infrastructure (Docker)
cd c:\Users\HP\UrbanPulse
docker compose up -d

2. Start All Backend Services
cd c:\Users\HP\UrbanPulse
.\start_backend.bat

3. Start Admin Dashboard
cd c:\Users\HP\UrbanPulse\apps\admin-dashboard
npm install
npm run dev

4. Start Citizen Mobile App
cd c:\Users\HP\UrbanPulse\apps\citizen-app
npm install
npm run start


Component	URL
Ingestion API	http://localhost:8006
Admin Dashboard	http://localhost:8083
Citizen App	http://localhost:8081



🔑 Admin Credentials
Email: admin@urbanpulse.local
Password: Admin@12345
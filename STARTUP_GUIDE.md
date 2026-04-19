# Hướng Dẫn Khởi Động Dự Án (AI Teaching Assistant)

Tài liệu này chứa các lệnh để khởi động môi trường phát triển (cả Frontend và Backend) của hệ thống AI Teaching Assistant.

> **Lưu ý quan trọng**: PPTX Service (dịch vụ tạo slide bằng Python) chạy tách biệt dưới dạng một FastAPI server trên port 3002. Bạn phải bật nó lên thì mới xuất ra file .pptx được.

## 1. Khởi động PPTX Service (Python FastAPI)

Mở một Terminal/PowerShell mới và chạy:

```powershell
cd f:\pptx_create_antigravity\ai-teaching-assistant\backend\utils\pptx_generator
# Cài đặt requirements nếu chạy lần đầu: pip install -r requirements.txt
uvicorn main:app --port 3002
```
*PPTX Service sẽ chạy tại: `http://localhost:3002`*

## 2. Khởi động Backend (NestJS)

Mở một Terminal/PowerShell mới và chạy:

```powershell
cd f:\pptx_create_antigravity\ai-teaching-assistant\backend
npm run start:dev
```
*Backend sẽ chạy tại: `http://localhost:3001`*

## 2. Khởi động Frontend (React/Vite)

Mở một Terminal/PowerShell mới và chạy:

```powershell
cd f:\pptx_create_antigravity\ai-teaching-assistant\frontend
npm run dev
```
*Frontend sẽ chạy tại: `http://localhost:3000` hoặc port mặc định của Vite (có thể 5173).*

## 3. Khởi chạy Database (PostgreSQL & Redis)

Backend yêu cầu database đã được bật (sử dụng Docker Compose hoặc database server thực).

```powershell
# Chạy Docker Compose nếu dùng Docker trên máy local
cd f:\pptx_create_antigravity\ai-teaching-assistant
docker-compose up -d
```

## 4. Kiểm tra cấu hình kết nối

* Hãy chắc chắn file `backend/.env` đã có đầy đủ `DATABASE_URL` và `JWT_SECRET`.
* Hãy chắc chắn file `frontend/.env` đã cấu hình `VITE_API_URL=http://localhost:3001` để frontend trỏ đúng API của backend.

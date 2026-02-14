# 🚀 AI Teaching Assistant - Hướng Dẫn Deploy & Update

## Tổng Quan CI/CD

```
Code Push → GitHub Actions Build → GHCR → VPS Pull → Restart
```

---

## 📦 Khi Có Thay Đổi Code

### Bước 1: Push Code Lên GitHub

```bash
# Từ máy local
git add .
git commit -m "Mô tả thay đổi"
git push origin main
```

### Bước 2: Chờ GitHub Actions Build

- Vào: https://github.com/xuanhoatrieu/ai-teaching-assistant/actions
- Chờ build hoàn thành (✅ xanh)
- Thời gian: ~5-7 phút

### Bước 3: Update Trên VPS

```bash
# SSH vào VPS
cd ~/ai-teaching-assistant

# Pull images mới
docker compose pull

# Restart containers
docker compose down
docker compose up -d

# Kiểm tra status
docker compose ps
```

---

## 🔄 Các Lệnh Thường Dùng Trên VPS

### Xem Logs
```bash
# Backend logs
docker compose logs backend --tail=50 -f

# Frontend logs
docker compose logs frontend --tail=50 -f

# Tất cả logs
docker compose logs --tail=50 -f
```

### Restart Services
```bash
# Restart tất cả
docker compose down && docker compose up -d

# Restart 1 service
docker compose restart backend
```

### Database
```bash
# Chạy migration (khi có thay đổi schema)
docker compose exec backend npx prisma migrate deploy

# Mở Prisma Studio (quản lý DB)
docker compose exec backend npx prisma studio

# Backup database
docker compose exec postgres pg_dump -U postgres ai_teaching > backup_$(date +%Y%m%d).sql

# Restore database
docker compose exec -T postgres psql -U postgres ai_teaching < backup.sql
```

---

## 🆘 Troubleshooting

### Container không khởi động
```bash
# Xem lỗi chi tiết
docker compose logs <service_name> --tail=100

# Kiểm tra config
docker compose config
```

### Rollback về version cũ
```bash
# Xem các tags có sẵn
# Vào: https://github.com/xuanhoatrieu/ai-teaching-assistant/pkgs/container

# Pull version cụ thể
docker pull ghcr.io/xuanhoatrieu/ai-teaching-assistant/backend:<commit_sha>
docker pull ghcr.io/xuanhoatrieu/ai-teaching-assistant/frontend:<commit_sha>

# Sửa docker-compose.yml để dùng tag cụ thể
# Thay :main thành :<commit_sha>
```

### Xóa cache và rebuild
```bash
docker compose down
docker system prune -f
docker compose pull
docker compose up -d
```

---

## 📋 Checklist Deploy

- [ ] Code đã push lên GitHub
- [ ] GitHub Actions build thành công
- [ ] VPS đã pull images mới
- [ ] Containers đang chạy (docker compose ps)
- [ ] Test đăng nhập frontend
- [ ] Test API endpoint

---

## 🌐 URLs

| Service | URL |
|---------|-----|
| Frontend | https://ai.hoclieu.id.vn |
| Backend API | https://api.hoclieu.id.vn |
| MinIO Console | http://VPS_IP:9001 |

---

## 📁 Cấu Trúc Thư Mục VPS

```
~/ai-teaching-assistant/
├── docker-compose.yml      # Config chính
├── .env                    # Environment variables (BẢO MẬT!)
├── nginx/
│   └── default.conf        # Nginx proxy config
└── datauser/               # User data (audio, images)
```
## Tạo tài khoản admin
docker compose exec postgres psql -U postgres -d ai_teaching -c "UPDATE users SET role = 'ADMIN' WHERE email = 'xuanhoaspt@gmail.com';"
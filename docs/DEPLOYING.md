# 🚀 AI Teaching Assistant - Hướng Dẫn Deploy VPS

**Repo:** https://github.com/xuanhoatrieu/ai-teaching-assistant  
**Version:** 1.0.0

---

## ✅ Checklist tiến độ

- [x] Bước 1: Tạo folder trên VPS
- [ ] Bước 2: Cài Docker (nếu chưa có)
- [ ] Bước 3: Tạo file .env.production
- [ ] Bước 4: Login GitHub Container Registry
- [ ] Bước 5: Download docker-compose.yml
- [ ] Bước 6: Khởi động containers
- [ ] Bước 7: Chạy database migration
- [ ] Bước 8: Cấu hình Cloudflare Tunnel

---

## Bước 2: Cài Docker (nếu chưa có)

```bash
# Kiểm tra Docker đã cài chưa
docker --version

# Nếu chưa có, chạy lệnh sau:
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# QUAN TRỌNG: Logout và login lại để áp dụng quyền Docker
exit
# Sau đó SSH lại vào VPS
```

**Kiểm tra Docker hoạt động:**
```bash
docker run hello-world
```

---

## Bước 3: Tạo file .env.production

```bash
cd ~/ai-teaching-assistant

# Tạo file .env.production
nano .env.production
```

**Copy nội dung sau và SỬA các giá trị có ghi CHANGE:**

```env
# GitHub Repository
GITHUB_REPO=xuanhoatrieu/ai-teaching-assistant

# Database - THAY ĐỔI PASSWORD
POSTGRES_DB=ai_teaching
POSTGRES_USER=postgres
POSTGRES_PASSWORD=CHANGE_THIS_password123

# JWT Secret - Chạy lệnh này để tạo: openssl rand -hex 32
JWT_SECRET=CHANGE_THIS_paste_64_char_random_string_here

# Encryption Key - Đúng 32 ký tự
ENCRYPTION_KEY=CHANGE_32_characters_exactly!

# MinIO Storage - THAY ĐỔI PASSWORD
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=CHANGE_minio_password123
MINIO_BUCKET=ai-teaching

# CLIProxy (đã có sẵn)
CLIPROXY_URL=https://cliproxy.hoclieu.id.vn
CLIPROXY_API_KEY=ai-teaching-assistant-prod

# API URL - Thay bằng domain của bạn
API_URL=https://api.hoclieu.id.vn
```

**Lưu file:** `Ctrl+O` → Enter → `Ctrl+X`

**Tạo JWT_SECRET tự động:**
```bash
echo "JWT_SECRET=$(openssl rand -hex 32)" 
# Copy kết quả vào file .env.production
```

---

## Bước 4: Login GitHub Container Registry

### 4.1. Tạo Personal Access Token (PAT) trên GitHub

1. Vào https://github.com/settings/tokens
2. Click **"Generate new token (classic)"**
3. Đặt tên: `vps-deploy`
4. Chọn scope: ✅ `read:packages`
5. Click **"Generate token"**
6. **COPY TOKEN NGAY** (chỉ hiện 1 lần!)

### 4.2. Login trên VPS

```bash
# Thay YOUR_TOKEN bằng token vừa copy
echo "YOUR_TOKEN" | docker login ghcr.io -u xuanhoatrieu --password-stdin
```

**Thành công sẽ thấy:** `Login Succeeded`

---

## Bước 5: Download docker-compose.yml

```bash
cd ~/ai-teaching-assistant

# Download file docker-compose
curl -fsSL https://raw.githubusercontent.com/xuanhoatrieu/ai-teaching-assistant/main/docker-compose.registry.yml -o docker-compose.yml

# Download script rollback
mkdir -p scripts
curl -fsSL https://raw.githubusercontent.com/xuanhoatrieu/ai-teaching-assistant/main/scripts/rollback.sh -o scripts/rollback.sh
chmod +x scripts/rollback.sh
```

---

## Bước 6: Khởi động containers

```bash
cd ~/ai-teaching-assistant

# Pull images (lần đầu sẽ mất 5-10 phút)
docker compose pull

# Khởi động tất cả services
docker compose up -d

# Kiểm tra trạng thái
docker compose ps
```

**Tất cả service phải ở trạng thái `running` hoặc `healthy`**

---

## Bước 7: Chạy Database Migration

```bash
# Đợi database khởi động xong (30 giây)
sleep 30

# Chạy migration
docker compose exec backend npx prisma migrate deploy

# Seed data ban đầu (optional)
docker compose exec backend npx prisma db seed
```

---

## Bước 8: Cấu hình Cloudflare Tunnel

Vào Cloudflare Dashboard → Zero Trust → Access → Tunnels → Chọn tunnel

**Thêm 2 Public Hostnames:**

| Hostname | Service |
|----------|---------|
| `hoclieu.id.vn` | `http://ai-teaching-frontend:80` |
| `api.hoclieu.id.vn` | `http://ai-teaching-backend:3001` |

---

## ✅ Kiểm tra hoàn tất

```bash
# Kiểm tra tất cả containers
docker compose ps

# Xem logs nếu có lỗi
docker compose logs -f

# Test API
curl http://localhost:3001/health
```

**Truy cập web:** https://hoclieu.id.vn (hoặc domain của bạn)

---

## 🔄 Cách Update sau này

Khi bạn push code mới lên GitHub:
1. GitHub Actions tự động build image mới
2. Watchtower trên VPS tự động pull và restart (mỗi 5 phút)

**Hoặc update thủ công:**
```bash
cd ~/ai-teaching-assistant
docker compose pull
docker compose up -d
```

---

## ⏪ Rollback nếu có lỗi

```bash
cd ~/ai-teaching-assistant
./scripts/rollback.sh v1.0.0
```

---

## 🆘 Troubleshooting

### Container không start
```bash
docker compose logs backend
docker compose logs frontend
```

### Database connection failed
```bash
docker compose logs postgres
# Kiểm tra password trong .env.production
```

### Không pull được image
```bash
# Login lại
docker login ghcr.io -u xuanhoatrieu
# Kiểm tra PAT còn hạn không
```

---

## 📞 Support

Nếu gặp lỗi, chạy lệnh này và gửi kết quả:
```bash
docker compose ps && docker compose logs --tail=50
```

# US-017 OpenAI Personal Key

## Status

done

## Lane

normal

## Product Contract

Cho phép người dùng tự nhập OpenAI API Key và Base URL cá nhân của họ tại trang Cài đặt (User Settings). Bổ sung tính năng kiểm tra kết nối API key và khám phá động các mô hình OpenAI của người dùng để chọn cấu hình cho các tác vụ AI.

## Relevant Product Docs

- `docs/product/user-settings.md`

## Acceptance Criteria

- [x] dropdown dịch vụ trong modal Thêm API Key hiển thị thêm mục "OpenAI (Cá nhân)".
- [x] Chọn dịch vụ "OpenAI (Cá nhân)" hiển thị 2 trường nhập: "OpenAI API Key" (dạng password, bắt buộc) và "Base URL" (dạng text, mặc định là `https://api.openai.com/v1`).
- [x] Bổ sung nút "Kiểm tra kết nối" (Test Connection) trong modal thêm/sửa key cho dịch vụ OpenAI và Gemini.
- [x] Khi bấm nút "Kiểm tra kết nối", frontend gọi API `POST /user/api-keys/test` để thử kết nối, và hiển thị phản hồi "Thành công" hoặc "Lỗi" rõ ràng trên UI.
- [x] Khi người dùng bấm "Khám phá Models" ở trang Cài đặt, hệ thống sẽ kết nối tới OpenAI cá nhân (nếu đã cấu hình) để lấy danh sách các model, map chúng dưới dạng `custom_openai:personal:<model_id>` với hậu tố `(Cá nhân)`.
- [x] Người dùng có thể chọn và lưu cấu hình model cá nhân cho từng tác vụ và hệ thống sẽ tự động ưu tiên lấy key cá nhân của người dùng để thực hiện cuộc gọi.
- [x] Logic lấy key cá nhân được mã hóa và giải mã an toàn qua CryptoUtil.

## Design Notes

- Commands: API `POST /user/api-keys`, `PUT /user/api-keys/:id` để lưu key, `POST /user/api-keys/test` để test.
- Queries: API `GET /user/api-keys` và `GET /user/api-keys/check/OPENAI`.
- API: Cập nhật `APIService` enum trong database schema.
- Tables: Bảng `api_keys` lưu bản ghi có `service: 'OPENAI'`.
- Domain rules: Thứ tự ưu tiên OpenAI key: User personal key > System provider config.
- UI surfaces: Trang UserSettings của Frontend.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | Test build backend và frontend thành công |
| Integration | Chạy thử tác vụ AI với mô hình Custom OpenAI và xác nhận log backend lấy đúng key cá nhân của user |
| E2E | |
| Platform | |
| Release | |

## Harness Delta

Không có.

## Evidence

- Đã biên dịch backend thành công (`npm run build` thành công).
- Đã biên dịch frontend thành công (`tsc -b && vite build` thành công).


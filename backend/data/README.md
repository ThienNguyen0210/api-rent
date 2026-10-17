# Tab Thông báo (Notifications): vị trí từng file

"backend/src" = thư mục chứa server.js, db.js, config.js. "frontend/src" = thư mục chứa App.jsx.
Không cần cài thêm thư viện và không cần sửa database.

| File trong zip                                    | Hành động | Đặt tại                                           |
|---------------------------------------------------|-----------|---------------------------------------------------|
| backend/src/routes/index.js                       | THAY THẾ  | backend/src/routes/index.js (đã gồm referrals, support) |
| backend/src/routes/notifications.js               | MỚI       | backend/src/routes/notifications.js               |
| backend/src/services/notificationService.js       | MỚI       | backend/src/services/notificationService.js       |
| backend/data/notifications.json                   | MỚI       | backend/data/notifications.json (thư mục data nằm cạnh src) |
| frontend/src/App.jsx                              | THAY THẾ  | frontend/src/App.jsx (đã gồm referral, support)   |
| frontend/src/api/index.js                         | THAY THẾ  | frontend/src/api/index.js                         |
| frontend/src/layouts/DashboardLayout.jsx          | THAY THẾ  | frontend/src/layouts/DashboardLayout.jsx          |
| frontend/src/pages/dashboard/Notifications.jsx    | MỚI       | frontend/src/pages/dashboard/Notifications.jsx    |
| frontend/src/styles/notifications.css             | MỚI       | frontend/src/styles/notifications.css             |
| i18n-notifications.md                             | THỦ CÔNG  | copy các khóa vào file ngôn ngữ vi và en          |

Khởi động lại backend một lần sau khi thêm file. Sau đó sửa notifications.json không cần restart.

## Cách thêm thông báo (dành cho admin)
Mở backend/data/notifications.json, thêm một đối tượng vào mảng:

  {
    "id": "bao-tri-2026-10-20",            // bắt buộc, duy nhất, không đổi sau khi đăng
    "date": "2026-10-20T08:00:00Z",        // bắt buộc, giờ UTC. Ngày ở tương lai = tự động hiện khi đến giờ
    "type": "warning",                     // info | update | warning | success (mặc định info)
    "title": { "en": "Maintenance", "vi": "Bảo trì hệ thống" },       // bắt buộc, ít nhất 1 ngôn ngữ
    "body":  { "en": "Short downtime.", "vi": "Gián đoạn ngắn." },    // tùy chọn, xuống dòng bằng \n
    "url": "/dashboard/billing"            // tùy chọn: đường dẫn trong app (bắt đầu bằng /) hoặc https://...
  }

- Người dùng thấy ngôn ngữ mình đang chọn; nếu thiếu thì dùng "en", rồi đến ngôn ngữ đầu tiên có sẵn.
- Mới nhất hiện trên cùng (theo "date"). Tối đa 100 thông báo gần nhất.
- Lỗi cú pháp JSON: hệ thống giữ danh sách cũ và ghi lỗi vào log backend. Mục thiếu id/date/title bị bỏ qua và có cảnh báo trong log.
- Xóa thông báo: xóa đối tượng đó khỏi file.

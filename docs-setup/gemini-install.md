# Hướng dẫn thiết lập Gemini API & Tối ưu hóa Aider

Tài liệu này tập trung vào cách cấu hình `server.js` và `aider` để tránh lỗi 429 (Too Many Requests).

## 1. Cấu hình API Key (File .env)
Dùng API Key sạch, không có dấu ngoặc kép.
```env
GEMINI_API_KEY=AIzaSyAxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## 2. Tạo API Key "Trả phí" (Paid Key)
Key này được tạo trực tiếp trong Project đã bật Billing:
```bash
gcloud alpha services api-keys create --display-name="Gemini_Paid_Key" --project=[PROJECT_ID]
gcloud alpha services api-keys get-key-string [NAME_CUA_KEY] --project=[PROJECT_ID]
```

## 3. Cấu hình Aider "Agentic Mode" (Tối ưu hóa server.js)
Để tránh 429, hãy sử dụng các tham số sau khi gọi `aider`:
- `--model gemini/gemini-2.5-flash`: Sử dụng model Flash mạnh nhất năm 2026.
- `--architect`: Cho phép AI tự suy nghĩ kiến trúc và đọc thêm file nếu cần.
- `--map-tokens 4096`: Cung cấp tầm nhìn rộng cho toàn bộ mã nguồn.
- `--no-check-update`: Tắt kiểm tra cập nhật để tiết kiệm request phụ trợ. 
- `--set-env GOOGLE_API_KEY=[API_KEY]`: Truyền khóa xác thực chuẩn xác.
- Kiểm tra trên google console Generative language API service: Có đang thiếu service account không? 

## 4. Kiểm tra sức khỏe API (Xác nhận Quota)
Dùng `curl` để kiểm tra phản hồi từ Google:
```bash
curl -i -s -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=[API_KEY]" \
-H 'Content-Type: application/json' \
-d '{"contents": [{"parts":[{"text": "ping"}]}]}'
```
*Gợi ý:* Nếu phản hồi `HTTP 200` và không thấy Header `x-ratelimit`, có nghĩa bạn đang dùng Gói Trả Phí.

## 6. Sử dụng Service Account thay cho API Key

Nếu bạn muốn chuyển sang sử dụng Service Account cho bảo mật và hạn ngạch cao hơn (Vertex AI), hãy làm theo 2 bước:

1.  **Chỉnh sửa model trong `aiderArgs`**:
    Chuyển `'gemini/gemini-2.5-flash'` sang `'vertex_ai/gemini-2.5-flash'`.

2.  **Cấu hình biến môi trường trong `server.js`**:
    Trong phần `spawn`, thêm `GOOGLE_APPLICATION_CREDENTIALS` trỏ tới file JSON vừa tải:
    ```javascript
    env: { 
        ...process.env, 
        GOOGLE_APPLICATION_CREDENTIALS: path.join(__dirname, 'service-account-key.json'),
        // ... các biến khác
    }
    ```

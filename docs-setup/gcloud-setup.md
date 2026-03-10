# Hướng dẫn thiết lập Google Cloud CLI & Billing

Tài liệu này hướng dẫn cách thiết lập `gcloud CLI` để quản lý dự án và kích hoạt gói trả phí cho Gemini API.

## 1. Cài đặt gcloud CLI (Linux)
Nếu chưa có `gcloud`, chạy lệnh sau để cài đặt cục bộ:
```bash
curl -O https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-x86_64.tar.gz
tar -xf google-cloud-cli-linux-x86_64.tar.gz
./google-cloud-sdk/install.sh
source ~/.bashrc
```

## 2. Xác thực và Chọn Project
```bash
# Đăng nhập vào tài khoản Google
gcloud auth login

# Thiết lập Project ID làm mặc định
gcloud config set project [PROJECT_ID]
```

## 3. Quản lý Billing (Kích hoạt gói Trả phí)
Để vượt qua lỗi 429 (15 requests/phút), bạn cần liên kết Billing Account.

```bash
# Liệt kê các Billing Account khả dụng
gcloud billing accounts list

# Liên kết Project với Billing Account (Thay ACCOUNT_ID bằng ID từ lệnh trên)
gcloud billing projects link [PROJECT_ID] --billing-account=[ACCOUNT_ID]
```

## 4. Kiểm tra Hạn ngạch (Quota)
Dùng lệnh này để biết chính xác bạn có bao nhiêu lượt gọi/phút (RPM) và Token/phút (TPM).

```bash
# Cài đặt thành phần alpha nếu chưa có
gcloud components install alpha

# Kiểm tra hạn ngạch của Gemini API
gcloud alpha services quota list \
    --consumer=projects/[PROJECT_ID] \
    --service=generativelanguage.googleapis.com \
    --format="table(displayName, limit, unit, effectiveLimit)"
```
*Lưu ý: Gói trả phí thường có giới hạn 1500 RPM (Requests Per Minute).*

## 5. Kích hoạt các API cần thiết
```bash
gcloud services enable generativelanguage.googleapis.com
gcloud services enable cloudresourcemanager.googleapis.com
gcloud services enable aiplatform.googleapis.com
```

## 6. Thiết lập Service Account (Cho môi trường Production)
Đây là cách xác thực chính thống thay cho API Key.

```bash
# 1. Tạo Service Account mới
gcloud iam service-accounts create ai-agent-service --display-name="AI Agent Service Account"

# 2. Cấp các quyền (Roles) cần thiết cho Service Account
Bạn cần cấp ít nhất 2 quyền sau để Service Account hoạt động:
```bash
# Quyền sử dụng Vertex AI & Gemini
gcloud projects add-iam-policy-binding [PROJECT_ID] \
    --member="serviceAccount:ai-agent-service@[PROJECT_ID].iam.gserviceaccount.com" \
    --role="roles/aiplatform.user"

# Quyền truy cập thông tin Billing/Quota
gcloud projects add-iam-policy-binding [PROJECT_ID] \
    --member="serviceAccount:ai-agent-service@[PROJECT_ID].iam.gserviceaccount.com" \
    --role="roles/serviceusage.serviceUsageConsumer"
```

# 3. Tạo và tải xuống tệp khóa JSON (Credentials)
```bash
gcloud iam service-accounts keys create service-account-key.json \
    --iam-account=ai-agent-service@[PROJECT_ID].iam.gserviceaccount.com
```
```
*Lưu ý: Tệp `service-account-key.json` cực kỳ quan trọng, tuyệt đối không commit lên Git.*

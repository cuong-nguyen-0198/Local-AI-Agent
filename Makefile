# Makefile cho Local AI Agent (Google Cloud & Gemini)

# Tự động nạp biến môi trường từ file .env
ifneq (,$(wildcard ./.env))
    include .env
    export
endif

.PHONY: install-gcloud auth link-billing quota-check service-account-setup start clean-logs

# 1. Cài đặt gcloud CLI
install-gcloud:
	@echo "Installing Google Cloud SDK..."
	curl -O https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-x86_64.tar.gz
	tar -xf google-cloud-cli-linux-x86_64.tar.gz
	./google-cloud-sdk/install.sh --quiet --path-update true
	@echo "Vui lòng chạy 'source ~/.bashrc' hoặc mở terminal mới."

# 2. Đăng nhập và cấu hình Project
auth:
	./google-cloud-sdk/bin/gcloud auth login
	./google-cloud-sdk/bin/gcloud config set project $(PROJECT_ID)
	./google-cloud-sdk/bin/gcloud services enable generativelanguage.googleapis.com cloudresourcemanager.googleapis.com aiplatform.googleapis.com

# 3. Liên kết Billing (Vượt lỗi 429)
link-billing:
	./google-cloud-sdk/bin/gcloud billing projects link $(PROJECT_ID) --billing-account=$(BILLING_ACCOUNT_ID)

# 4. Kiểm tra Hạn ngạch (RPM/TPM)
quota-check:
	./google-cloud-sdk/bin/gcloud alpha services quota list --consumer=projects/$(PROJECT_ID) --service=generativelanguage.googleapis.com --format="table(displayName, limit, unit, effectiveLimit)"

# 5. Thiết lập Service Account & JSON Key
service-account-setup:
	./google-cloud-sdk/bin/gcloud iam service-accounts create $(SERVICE_ACCOUNT_NAME) --display-name="AI Agent Service Account" || true
	./google-cloud-sdk/bin/gcloud projects add-iam-policy-binding $(PROJECT_ID) --member="serviceAccount:$(SERVICE_ACCOUNT_NAME)@$(PROJECT_ID).iam.gserviceaccount.com" --role="roles/aiplatform.user"
	./google-cloud-sdk/bin/gcloud projects add-iam-policy-binding $(PROJECT_ID) --member="serviceAccount:$(SERVICE_ACCOUNT_NAME)@$(PROJECT_ID).iam.gserviceaccount.com" --role="roles/serviceusage.serviceUsageConsumer"
	./google-cloud-sdk/bin/gcloud iam service-accounts keys create service-account-key.json --iam-account=$(SERVICE_ACCOUNT_NAME)@$(PROJECT_ID).iam.gserviceaccount.com

# 6. Chạy Server
start:
	yarn start

# 7. Dọn dẹp Log và Tiến trình cũ
clean:
	pkill -f "node server.js" || true
	rm -f server.log aider-debug.log quota.json
	@echo "Đã dọn dẹp xong."

# 8. Hướng dẫn nhanh
help:
	@echo "Sử dụng các lệnh sau:"
	@echo "  make auth              - Đăng nhập Google Cloud (Lấy cấu hình từ .env)"
	@echo "  make link-billing      - Kích hoạt gói trả phí (Sửa lỗi 429)"
	@echo "  make quota-check       - Xem hạn ngạch hiện tại"
	@echo "  make service-account-setup - Tạo JSON Key cho Production"
	@echo "  make start             - Chạy ứng dụng"

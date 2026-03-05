# Ngữ cảnh dự án Go
- Framework sử dụng: Echo, GORM.
- Cấu trúc thư mục: Clean Architecture (handler, service, repository, model).
- Khi đổi tên biến trong Model, BẮT BUỘC phải đổi cả tag `json`.
- Định dạng file test: `*_test.go`.
- Lệnh chạy test: `go test ./...`
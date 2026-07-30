# Crypto Dashboard

Static site (Vercel) + serverless functions. Không có build step — mọi UI là HTML/JS thuần trong `public/`.

## Trang

- `public/index.html` — dashboard giá, chart, chỉ báo kỹ thuật
- `public/backtest.html` — mô phỏng backtest chiến lược RSI / MA Cross
- `public/alert.html` — cảnh báo giá + watchlist, đồng bộ server để chạy nền

## Setup

1. Tạo Redis database tại [Upstash](https://upstash.com), lấy `UPSTASH_REDIS_REST_URL` và `UPSTASH_REDIS_REST_TOKEN`.
2. Tự sinh 2 chuỗi random (vd `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`) dùng cho `ALERTS_API_SECRET` và `CRON_SECRET`.
3. Khai các biến trên trong Vercel Project Settings → Environment Variables (xem `.env.example`).
4. Trong `public/alert.html`, mở modal cài đặt (⚙) → dán `ALERTS_API_SECRET` vào ô "API Secret" để trình duyệt được phép đọc/ghi `/api/alerts`.
5. Tạo Telegram bot qua [@BotFather](https://t.me/BotFather), lấy chat ID qua [@userinfobot](https://t.me/userinfobot), nhập vào modal cài đặt của `alert.html`.
6. Để cảnh báo giá chạy nền (kể cả khi tắt trình duyệt), cần 1 cron **ngoài** Vercel gọi định kỳ (1–5 phút):
   ```
   GET https://<domain>/api/check-alerts?key=<CRON_SECRET>
   ```
   Gợi ý dùng [cron-job.org](https://cron-job.org) (miễn phí) hoặc GitHub Actions `schedule`. Vercel Hobby plan chỉ cho cron tối đa 1 lần/ngày nên không dùng `vercel.json` cho việc này được — `vercel.json` hiện chỉ khai cron cho `daily-digest` (01:00 mỗi ngày).

## API

| Route | Method | Auth | Mô tả |
|---|---|---|---|
| `/api/alerts` | GET/POST | header `x-api-key` = `ALERTS_API_SECRET` | đọc/ghi alerts, watchlist, Telegram config |
| `/api/check-alerts` | GET | query `?key=` = `CRON_SECRET` | kiểm tra giá, gửi Telegram khi alert khớp — cần cron ngoài gọi định kỳ |
| `/api/daily-digest` | GET | cron nội bộ Vercel | tóm tắt thị trường qua Telegram, chạy 01:00 mỗi ngày |

# Handoff
**Son güncelleme:** 2026-07-28 — self-host pazarlama temizliği

## Durum
Self-host pazarlama vaadi kaldırıldı, site ürün vitrini + kurulum rehberi olarak devam ediyor. Tüm doküman ve site metinleri güncellendi.

## Son yapılan
- Marketing site metinlerindeki "self-hostable / self-host / 5€ VPS" vaatleri çıkarıldı.
- `docs/self-host.md` → `docs/install.md` olarak rename edildi ve tonu nötrleştirildi.
- README, CONTRIBUTING, SECURITY, issue template, docs/*, CLAUDE.md/AGENTS.md, .env.example, env.ts, docker-compose.yml güncellendi.
- `docs/decisions.md` karar kaydı eklendi.

## Sıradaki adım
1. Grep sweep + `npm run lint` + `npm run typecheck` + `npm run build` çalıştır.
2. Başarılıysa commit at.

## Dikkat
- Altyapı kodu (Dockerfile, cron, ops dashboard, rate limit, Sentry/Umami) dokunulmadı; hosted prod/test bunlara ihtiyaç duyar.
- `messages/*.json` marketing bloğu eski Mini App döneminden kalma ve şu an projede tüketici yok; sadece self-host ifadeleri ve subtitle'daki Mini App referansı düzeltildi. Tam temizlik ayrı iş.

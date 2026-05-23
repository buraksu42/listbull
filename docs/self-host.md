# Self-host listbull — adım adım

Telegram-native AI to-do botunu kendi sunucunda çalıştırmak için
bu dokümanı baştan sona uygula. Tahmini süre: 20-30 dakika
(DNS propagation + ilk Docker build dahil).

> Phase 17 chat-only mimari: tek surface bot. Mini App / workspace
> / multi-list mimarisi yok. Bir Telegram chat = bir to-do context.

---

## Önkoşullar

- **Bir sunucu** (ör. Hetzner CPX21 5€/ay yeterli). Docker +
  Docker Compose kurulu. SSH erişimin olsun.
- **Bir domain** (subdomain olur, ör. `listbull.mydomain.com`).
  DNS yönetimine erişimin olsun.
- **Bir Telegram hesabı.**
- (Opsiyonel) **Bir OpenRouter hesabı** (https://openrouter.ai).
  Kendi key'ini her kullanıcı `/settings`'ten verebilir; alternatif
  olarak operator olarak shared bir free-tier key set edebilirsin.
- Lokalde `git`, `openssl`, `curl`.

---

## 1. Telegram botunu yarat

Telegram'da [@BotFather](https://t.me/BotFather):

1. `/newbot` → bot adı (display) + username (`...bot` ile bitmeli) ver.
2. BotFather sana **HTTP API token** verir (`1234567890:ABC-DEF...`).
   Güvenli sakla.

---

## 2. DNS

Domain'inin A record'u sunucu IP'sine işaret etmeli:

```
A   listbull.mydomain.com   → <SUNUCU_IP>
```

> Cloudflare kullanıyorsan proxy modu **OFF** olsun (Let's Encrypt
> HTTP-01 challenge için).

`dig listbull.mydomain.com +short` sunucu IP'sini gösteriyorsa hazır.

---

## 3. Repo'yu klonla + `.env` hazırla

```bash
git clone https://github.com/buraksu42/listbull.git
cd listbull
cp .env.example .env
chmod 600 .env
```

---

## 4. Secret'ları üret

```bash
# BYOK + secrets AES-256-GCM şifreleme key'i (32 byte base64)
echo "ENV_KEY=$(openssl rand -base64 32)"

# Telegram webhook signature secret (≥16 hex char)
echo "TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32)"

# Postgres şifresi
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)"
```

> **`ENV_KEY` rotation = veri kaybı.** Stored OpenRouter key'leri
> ve `/password` secret'ları bu key ile şifreleniyor; rotate edersen
> hepsi okunamaz hale gelir. Bir kere üret, güvenli sakla.

---

## 5. `.env` doldur

```bash
# Public URL (DNS'in işaret ettiği)
NEXT_PUBLIC_APP_URL=https://listbull.mydomain.com
NEXT_PUBLIC_ENV=production

# Adım 4'te ürettiğin secret'lar
ENV_KEY=...
TELEGRAM_WEBHOOK_SECRET=...
POSTGRES_PASSWORD=...

# Postgres bağlantısı (compose içi network)
DATABASE_URL=postgres://listbull:<POSTGRES_PASSWORD>@postgres:5432/listbull
POSTGRES_DB=listbull
POSTGRES_USER=listbull

# Adım 1'deki bot bilgisi
TELEGRAM_BOT_TOKEN=1234567890:ABC-DEF...
TELEGRAM_BOT_USERNAME=my_listbull_bot   # @ olmadan

# (Opsiyonel) Free-tier shared key — operator senin için ücretsiz
# bir OpenRouter free model kullanır, kullanıcılar kendi key'lerini
# vermeden bot'u deneyebilir.
# LISTBULL_SHARED_OPENROUTER_KEY=sk-or-v1-...
# LISTBULL_FREE_MODEL=openrouter/free

# (Opsiyonel) Sentry hata takibi
# NEXT_PUBLIC_SENTRY_DSN=
# SENTRY_ORG=
# SENTRY_PROJECT=
# SENTRY_AUTH_TOKEN=

# (Opsiyonel) Umami self-hosted analytics
# NEXT_PUBLIC_UMAMI_WEBSITE_ID=
```

---

## 6. Reverse proxy / TLS

listbull kendi HTTPS terminate etmiyor — önüne bir reverse proxy koy.
**En basit**: Caddy.

```
listbull.mydomain.com {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy otomatik Let's Encrypt sertifikası alır. Compose `app`'i
sadece localhost'a açar (`127.0.0.1:3000`), Caddy public 443'ten
proxy'ler.

**Dokploy kullanıyorsan**: panel domain ekle, Traefik otomatik
yapar.

---

## 7. Stack'i ayağa kaldır

```bash
docker compose up -d
docker compose logs -f app
```

`✓ Ready in ...ms` görene kadar bekle (ilk build için ~3-5 dk).

```bash
# Health check
curl -s https://listbull.mydomain.com/api/health
# Beklenen: {"status":"ok","db":"ok","bot":"ok",...}
```

---

## 8. DB migration'ları uygula

```bash
docker compose run --rm app npm run db:migrate
```

`[✓] migrations applied successfully!` görmelisin.

---

## 9. Bot konfigürasyonu

İki kısım: otomatik script + manuel BotFather adımları.

### 9a. Otomatik (script)

```bash
TELEGRAM_BOT_TOKEN="<token>" \
TELEGRAM_WEBHOOK_SECRET="<secret>" \
APP_BASE_URL="https://listbull.mydomain.com" \
  npm run setup:bot
```

Script yapar:
- `setWebhook` → `/api/telegram/webhook` (`message`, `callback_query`,
  `my_chat_member`, `chat_member` updates)
- `setMyCommands` → 12 slash command (items, done, memory, tag,
  today, thisweek, reminders, password, settings, onboarding, help,
  reset)
- `setChatMenuButton` → `{ type: "commands" }`
- `getWebhookInfo` ile doğrular

### 9b. Manuel (BotFather)

[@BotFather](https://t.me/BotFather) → botunu seç → **Bot Settings**:

- **`/setjoingroups`** → **Enable** (gruba eklenebilsin)
- **`/setprivacy`** → **Disable** (zorunlu — grup ses notlarını ve
  güvenilir @-mention yakalamayı bot'un görmesi için. Bot kendi
  privacy filter'ını kod içinde uyguluyor: yalnız mention edildiğinde
  veya birinin mesajına reply atıldığında LLM'e gönderiyor, dolayısıyla
  privacy ayarı OFF olsa da token israfı olmaz.)

---

## 10. Smoke test

Telegram'da kendi bot'una `/start` at — hoş geldin mesajı + "🎯 Hızlı
tur (3 dk)" butonu görmelisin. Butona tıkla → 8 adımlı onboarding.

Sonra:

```
süt al
```

Bot 2-5 saniyede:

```
✓ "süt al" eklendi.
```

`/items` → "süt al" görünür.

Daha komplike:

```
yarın 9'da diş hekimine git
süt al, 2 dakika sonra hatırlat
```

İkinci komut: cron container 2 dakika sonra sana DM atmalı.

Tam e2e matrix: [`docs/SMOKE_TEST.md`](./SMOKE_TEST.md).

---

## 11. (Opsiyonel) Sentry'ye bağla

1. https://sentry.io 'da yeni Next.js projesi → DSN al.
2. `.env`'de `NEXT_PUBLIC_SENTRY_DSN=https://...@sentry.io/...`.
3. **Build args'a da koy** (Next 16 Turbopack inline ediyor):
   ```bash
   docker compose build --no-cache app
   docker compose up -d --force-recreate app
   ```
4. Doğrulama (bundle scan):
   ```bash
   curl -s https://listbull.mydomain.com/_next/static/chunks/*.js \
     | grep -E 'ingest\.(de\.)?sentry\.io|@sentry|sentryDsn'
   ```

---

## 12. (Opsiyonel) Umami analytics

`NEXT_PUBLIC_UMAMI_WEBSITE_ID=<id>` ekle + rebuild. Detay:
[umami.is/docs](https://umami.is/docs).

---

## Webhook secret rotation

`TELEGRAM_WEBHOOK_SECRET` leak olduğunda:

1. **Yeni secret üret**: `openssl rand -hex 32` → güvenli sakla.
2. `.env`'de güncelle.
3. Restart: `docker compose up -d --force-recreate app`.
4. **Yeni secret'la `setWebhook` çağır** (eskisini iptal eder):
   ```bash
   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -H "content-type: application/json" \
     -d '{"url":"https://listbull.mydomain.com/api/telegram/webhook","secret_token":"<NEW_SECRET>"}'
   ```
5. Doğrula: `curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo`
   → `pending_update_count` zamanla 0'a düşmeli, `last_error_message`
   boş.

**Önemli**: adım 4'ten önce app eskiyi reddedip yeniyi kabul ediyor
olmalı (adım 3'teki restart). Sırayı tersine çevirirsen kısa downtime.

---

## Sorun giderme

### Bot mesaja cevap vermiyor

```bash
# Webhook gerçekten set mi
curl -s "https://api.telegram.org/bot${TOKEN}/getWebhookInfo" | jq

# App container log'larında gelen istek var mı
docker compose logs app | grep webhook | tail -20
```

`last_error_message` doluysa Telegram webhook'a ulaşamıyor → reverse
proxy / DNS / sertifika kontrol et.

### "AI özelliklerini kullanmak için OpenRouter key ekle"

İki seçenek: (a) `LISTBULL_SHARED_OPENROUTER_KEY` set et (operator
shared key — kullanıcı kendi key'ini vermek zorunda kalmaz), veya
(b) kullanıcı `/settings` → 🔑'den kendi key'ini girer.

### Migration fail oluyor

```bash
docker compose exec postgres psql -U listbull -d listbull \
  -c "SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id"
```

Listede son migration hash'ini görüyorsan idempotent — yeniden
koşmuyor. Yoksa container log'da spesifik hatayı ara.

---

## Telegram grup'larında kullan

Bot'u bir Telegram grubuna ekleyebilirsin:

1. Bot ayarlarında: `/setjoingroups Enable`, `/setprivacy Disable`
   (adım 9b).
2. Bot'u gruba ekle.
3. Grup içinde bot'a yaz: `@listbull_bot süt yumurta peynir` →
   grup'un to-do listesine 3 item eklenir.

Bot grup'ta:
- Yalnız mention edilince (`@bot ...`) veya bot mesajına reply
  atılınca LLM'e gider (kod-içi filter, token israfı yok).
- Ses notlarını **ambient** dinler — içinde to-do varsa düşer, yoksa
  sessiz kalır.
- Hatırlatıcılar gruba düşer (DM'e değil).
- `/password` save grup'ta engellenir (DM-only); reveal grup'tan
  yapılabilir (kullanıcı grubun üyesi olmak şartıyla).

---

## Yedekleme

Postgres dump cron'u önerilir:

```bash
# /etc/cron.d/listbull-backup
0 * * * * docker exec listbull-postgres pg_dump -U listbull listbull \
  | gzip > /backups/listbull-$(date +\%Y\%m\%d-\%H).sql.gz
```

Destination: Hetzner Storage Box, Backblaze B2 veya S3-uyumlu obje
depo.

---

## Attachment'lar nasıl saklanır

listbull dosyaları **kendi sunucusunda saklamaz**. Bot intake aldığında
sadece `telegram_file_id` (Telegram'ın CDN referansı) DB'ye yazılır.
Avantajı: sıfır disk + sıfır storage faturası.

⚠️ **Bot token rotation = attachment loss.** BotFather'da bot
yeniden yaratırsan veya `/revoke` ile token değiştirirsen tüm eski
`telegram_file_id` değerleri **geçersiz olur**. Bu Telegram Bot
API'nin yapısal sınırı.

---

## Güncellemek

```bash
cd ~/listbull
git pull
docker compose build app cron
docker compose up -d
docker compose run --rm app npm run db:migrate
```

Migration'lar idempotent.

---

## Yardım

- Issue: https://github.com/buraksu42/listbull/issues
- Security: [`SECURITY.md`](../SECURITY.md)
- Contributing: [`CONTRIBUTING.md`](../CONTRIBUTING.md)

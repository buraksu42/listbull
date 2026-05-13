# Self-host listbull — adım adım

Bir Telegram-native AI to-do botunu kendi sunucunda çalıştırmak için bu
dokümanı baştan sona uygula. Tahmini süre: 30-45 dakika (DNS propagation +
ilk Docker build dahil).

Sıfırdan kuruluyorsan baştan başla. Bot'un yanıt verdiğinde bittin demektir.

---

## Önkoşullar

Şunlara ihtiyacın var:

- **Bir sunucu** (ör. Hetzner CPX21 5€/ay yeterli). Docker + Docker
  Compose kurulu olsun. SSH erişimin olsun.
- **Bir domain** (ör. `myapp.com` ya da `listbull.mydomain.com`). DNS
  yönetimine erişimin olsun. Subdomain de olur.
- **Bir Telegram hesabı.** Bot yaratmak için.
- **Bir OpenRouter hesabı** (https://openrouter.ai). Tek operator-mode'da
  $5 yatırsan haftalarca yeter; her kullanıcı kendi key'ini getirirse
  hiç yatırma.
- Lokalde `git`, `openssl`, `curl` (komutlar için).

---

## 1. Telegram botunu yarat

1. Telegram'da [@BotFather](https://t.me/BotFather)'a `/newbot` gönder.
2. Bot adı (display) ve username (`...bot` ile bitmeli) ver.
3. BotFather sana **HTTP API token** verecek (ör.
   `1234567890:ABC-DEF...`). Bunu güvenli bir yerde sakla — `.env`'e
   yazacaksın.
4. BotFather'da bot ayarlarına git → şunları **şimdilik** değiştirme,
   adım 9'da geri döneceğiz.

> **İpucu**: bot adına `_bot` zorunlu ama display name'i istediğin gibi
> seçebilirsin ("Listbull", "Karen's Tasks" vs).

---

## 2. DNS yönetimi

Domain'inin A record'u sunucu IP'sine işaret etmeli. Cloudflare/Route53
gibi bir DNS panelinde:

```
A   myapp.com       → <SUNUCU_IP>
A   www.myapp.com   → <SUNUCU_IP>   (opsiyonel)
```

> Cloudflare kullanıyorsan proxy modu **OFF** olsun ki Let's Encrypt
> sertifika doğrulaması çalışabilsin.

Propagation 2-30 dakika sürer. `dig myapp.com +short` ile sunucu IP'sini
gösteriyorsa hazır.

---

## 3. Repo'yu klonla + `.env` hazırla

Sunucuda:

```bash
git clone https://github.com/buraksu42/listbull.git
cd listbull
cp .env.example .env
chmod 600 .env
```

---

## 4. Secret'ları üret

Lokalde ya da sunucuda — sonuçları `.env`'e yazacaksın:

```bash
# Better Auth session cookie imzalama secret'ı (≥32 byte)
echo "BETTER_AUTH_SECRET=$(openssl rand -base64 48)"

# BYOK ve workspace org-key AES-256-GCM şifrelemesi (32 byte base64)
echo "ENV_KEY=$(openssl rand -base64 32)"

# Telegram webhook doğrulama secret'ı (≥16 hex char)
echo "TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32)"

# Postgres şifresi (rastgele)
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)"
```

> **ENV_KEY rotation = veri kaybı**: Bu key her stored OpenRouter
> key'ini decrypt etmek için kullanılır. Rotate edersen tüm kullanıcılar
> key'lerini tekrar girmek zorunda. Bir kere üret, güvenli sakla.

---

## 5. `.env` doldur

`.env` dosyasını aç ve şu alanları doldur:

```bash
# Public URL (DNS'in işaret ettiği)
NEXT_PUBLIC_APP_URL=https://myapp.com
BETTER_AUTH_URL=https://myapp.com
NEXT_PUBLIC_ENV=production

# Adım 4'te ürettiğin secret'lar
BETTER_AUTH_SECRET=...
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

# OpenRouter — operator-mode kullanacaksan doldur, BYOK-only ise boş bırak
# (bkz adım 11)
OPENROUTER_API_KEY=sk-or-v1-...
OPERATOR_TELEGRAM_ID=                   # adım 8'de dolduracağız

# Opsiyonel: Sentry (hata takibi)
NEXT_PUBLIC_SENTRY_DSN=

# Opsiyonel: Umami (analytics)
NEXT_PUBLIC_UMAMI_WEBSITE_ID=
```

---

## 6. Reverse proxy / TLS

listbull kendi başına HTTPS terminate etmez. Önüne bir reverse proxy
koyman gerek. **En basit çözüm**: Traefik veya Caddy.

**Caddy örneği** (sunucuda `/etc/caddy/Caddyfile`):

```
myapp.com {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy otomatik Let's Encrypt sertifikası alır. Compose listbull'u
sadece localhost'a (`127.0.0.1:3000`) açar; Caddy public 443'ten
proxy'ler.

**Dokploy kullanıyorsan**: Dokploy'ın Traefik'i bunu otomatik yapar,
domain'i panelden eklemek yeterli.

---

## 7. Stack'i ayağa kaldır

```bash
docker compose up -d
docker compose logs -f app
```

`✓ Ready in ...ms` görene kadar bekle (~1 dakika ilk build için
3-5 dakika). Sonra Ctrl+C ile log'dan çık (servis arka planda kalır).

```bash
# Sağlık kontrolü
curl -s https://myapp.com/api/health
# Beklenen: {"status":"ok","db":"ok","bot":"ok",...}
```

`bot:"ok"` çıkmıyorsa bot token yanlıştır — `.env`'de düzelt,
`docker compose up -d --force-recreate app` ile restart at.

---

## 8. DB migration'ları uygula

İlk kurulumda Postgres boş. Migration'lar şemayı yaratır:

```bash
docker compose run --rm app npm run db:migrate
```

`[✓] migrations applied successfully!` görmelisin. Doğrulama:

```bash
docker compose exec postgres psql -U listbull -d listbull \
  -c "SELECT COUNT(*) FROM drizzle.__drizzle_migrations"
# 19 olmalı (mevcut versiyon)
```

---

## 9. Bot'u konfigüre et

İki kısımdan ibaret:

1. **Otomatik kısım** — webhook, slash komutları, chat-menu button.
   Tek script ile bitiyor.
2. **Manuel kısım** — `/newapp`, `/setmainminiapp`, `/setdomain`,
   `/setinline`, `/setinlinefeedback`, `/setjoingroups`. Bunlar
   BotFather'a özel komutlar; Telegram public Bot API'de karşılığı
   YOK, manuel çalıştırmak zorundasın.

### 9a. Otomatik (script)

Repo root'unda:

```bash
TELEGRAM_BOT_TOKEN="<your bot token>" \
TELEGRAM_WEBHOOK_SECRET="<your webhook secret>" \
APP_BASE_URL="https://myapp.com" \
  npm run setup:bot
```

Script şunları yapar:

- `setWebhook` → `https://myapp.com/api/telegram/webhook` (allowed
  updates: message, inline_query, **chosen_inline_result**,
  callback_query — Quick Create için `chosen_inline_result` zorunlu)
- `setMyCommands` → /start, /help, /lists, /share, /snapshot, /reset
- `setChatMenuButton` → Web App → `https://myapp.com/app`
- `getWebhookInfo` ile doğrular (pending=0, last_error=none beklenir)
- Sonunda **manuel BotFather adımlarını ekranına basar**, copy-paste
  ederek BotFather chat'ine girersin.

### 9b. Manuel (BotFather chat'i)

Script bittikten sonra basacağı adımlar (referans için burada da var):

[@BotFather](https://t.me/BotFather) → botunu seç → **Bot Settings**:

- **`/setdomain`** → `myapp.com`
- **`/setjoingroups`** → **Enable** (kullanıcılar bot'u gruplara
  ekleyip `/bindgroup` ile workspace bağlayabilsin)
- **`/setprivacy`** → **Enable** (privacy mode AÇIK — bot grup'ta
  yalnız @-mention'ları, /komutları ve bot'un mesajlarına gelen
  yanıtları görür; tüm grup sohbetini DEĞİL. OpenRouter parası
  patlamaz.)
- **`/setinline`** → **Enable**, placeholder: `Search items…`
- **`/setinlinefeedback`** → **Enabled** (Quick Create'in zorunlu
  ayağı — Telegram aksi takdirde `chosen_inline_result` update'ini
  yollamaz)

**Chat-list "Aç / Open" butonu için (Direct-link Mini App)** —
Telegram chat listesinde bot satırının yanında doğrudan launch ikonu
çıkması için ek olarak:

- **`/newapp`** → bot seç →
  - Title: `listbull`
  - Description: kısa pitch (ör. `AI list assistant — quick lists, reminders, shared`)
  - Photo: 640×360 PNG (yoksa `/cancel` ile atla, Telegram default kullanır)
  - Web App URL: `https://myapp.com/app`
  - Short name: `app` → link `t.me/<bot_username>/app` olur
- **`/setmainminiapp`** → bot seç → az önce yarattığın `app` →
  **Enabled**

İki adımı yaptıktan sonra Telegram client'ı **tam restart et** (chat-
list affordance aggressively cache'leniyor). Bot'un chat satırının
yanında launch ikonu çıkar; menu button'dan AYRIDIR — ikisi birlikte
çalışır.

---

## 11. OpenRouter key'ini set et (workspace'in sahibi sen)

listbull'da OpenRouter key **workspace seviyesinde** tanımlanır,
kullanıcı bazında değil. Bir kişi (workspace owner) key'i koyar,
o workspace'in tüm üyeleri onu kullanır.

Önce Mini App'i aç → /start sonrası **Open App** menu button →
Workspace ayarları → **Workspace API key** → https://openrouter.ai/keys
'den aldığın key'i yapıştır → Kaydet.

Key sunucuda AES-256-GCM ile şifrelenir (`ENV_KEY` adım 4'te
ürettiğin); plaintext bir daha gözükmez.

**Maliyet kontrolü**: OpenRouter dashboard'da credit limit + daily cap
ayarla. Aylık $5 credit yatır, "Don't auto-recharge" + günlük cap.
Bot key'i bittiğinde OpenRouter 402 döner ve sen Telegram'da
"transient error" görürsün — dashboard'da credit ekle, geri çalışır.

---

## 12. Bot'a `/start` at

Telegram'da kendi botunu aç, `/start` gönder. Şunu görmelisin:

```
Hoş geldin <ismin>! 
- /create_item ile aklındaki şeyleri yaz
- @<bot> diye yazıp inline'da ara
- 🪧 Web App butonundan listeleri yönet
```

`/start` arka planda:
- `users` tablosunda senin satırın yaratılır (Telegram first_name + locale)
- Senin için bir **Personal** workspace + **Inbox** listesi yaratılır

---

## 13. Mini App'i aç

Telegram chat'inde sağ alttaki **Web App** ikonu (menu button)'a tıkla.
Listbull açılır. URL `https://myapp.com/app`. Telegram initData ile
otomatik login olursun.

İlk açılışta **Inbox** listesini görmelisin (boş, /start ile yaratıldı).

Üst nav'da **Bugün / Hafta / Pano** quick links var:
- **Bugün**: tarihi bugüne denk gelen + in_progress + high-priority itemlar
- **Hafta**: önümüzdeki 7 günün ajandası
- **Pano**: workspace-wide Kanban (4 status kolonu + filter chip'leri)

---

## 14. (B veya hibrit modda) OpenRouter key'ini gir

Operator-mode kullanmıyorsan Mini App'te:

1. Settings (⚙️) → **OpenRouter API Key**
2. https://openrouter.ai/keys 'ten aldığın key'i yapıştır → Kaydet

Key sunucuda AES-256-GCM şifrelenir; sen Mini App'te de kuruluş
sonrası bir daha göremezsin (sadece "Tanımlı ✓" gösterir).

---

## 15. Smoke test

Telegram bot'a şunu yaz:

```
süt al
```

Bot 2-5 saniyede şöyle cevap vermeli:

```
✓ "süt al" Inbox'a eklendi.
```

Mini App'i aç → Inbox listesinde "süt al" görünüyor.

Daha komplike:

```
yarın 9'da diş hekimine git
```

→ deadline_at = yarın 09:00 ile item eklenir.

```
süt'ü tamamla
```

→ search_items + complete_item → ✓ ile gösterilir.

---

## 16. Cron + reminder testi

```
süt al, 2 dakika sonra hatırlat
```

→ item + reminder kurulur. 2 dakika sonra bot sana DM atmalı:
"⏰ süt al". Reminder gelmiyorsa:

```bash
docker compose logs cron | tail -20
# her 60s'de "[cron] tick — N reminders due" benzeri görmelisin
```

---

## 17. (Opsiyonel) Sentry'ye bağla

Hatalar production'da görünmez kalmaz:

1. https://sentry.io 'da yeni Next.js projesi yarat → DSN al
2. `.env`'de `NEXT_PUBLIC_SENTRY_DSN=https://...@sentry.io/...`
3. **Build args'a da koy** (Dockerfile ARG ile inline ediyor):
   ```bash
   docker compose build --no-cache app
   docker compose up -d --force-recreate app
   ```
4. Doğrulama:
   ```bash
   curl -s https://myapp.com/_next/static/chunks/*.js | grep -E 'ingest\.(de\.)?sentry\.io'
   # bir match çıkmalı
   ```

İlk gerçek hata Sentry dashboard'una düşmeli.

---

## 18. (Opsiyonel) Umami analytics

`NEXT_PUBLIC_UMAMI_WEBSITE_ID=<umami-website-id>` ekle + rebuild.
Detay: [umami.is/docs](https://umami.is/docs).

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

Operator-mode mu BYOK mu seçtin? Operator-mode'daysa `OPERATOR_TELEGRAM_ID`
senin telegram_id'ne eşit mi? Kontrol et:

```bash
docker compose exec postgres psql -U listbull -d listbull \
  -c "SELECT telegram_id, telegram_first_name FROM users"
```

`OPERATOR_TELEGRAM_ID=<o_id>` eşleşmeli. Değilse `.env`'de düzelt + restart.

### Mini App'te beyaz ekran

Tarayıcı dev tools console'una bak. Genelde:
- `BETTER_AUTH_URL` HTTPS değil → değiştir
- `NEXT_PUBLIC_APP_URL` Telegram BotFather'da set edilen domain'le
  eşleşmiyor (adım 9) → düzelt

### Migration fail oluyor

```bash
docker compose exec postgres psql -U listbull -d listbull \
  -c "SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id"
```

Listede 19 hash görüyorsan migration'lar zaten uygulanmış. Yoksa
container log'da spesifik hatayı ara.

---

## Yeni kullanıcı davet et

Workspace owner'sın (sen). Mini App `Workspace ayarları → Üyeler`'e
git, `@username` veya Telegram username gir → davet linki çıkacak.
O kullanıcı linki tıklayınca senin workspace'inin üyesi olur, senin
operator-mode key'inle (varsa) bot kullanabilir.

---

## Telegram grup'larında kullan

listbull bot'unu bir Telegram grubuna ekleyip "konuşulan bir şeyi
to-do açma" akışını grup içinden kullanabilirsin. Şartlar:

1. **Bot ayarlarında**: `/setjoingroups Enable` ve `/setprivacy
   Enable` BotFather'dan yapılmış olmalı (Adım 9b).
2. **Workspace bağlanmış olmalı**: grup'a giren bir workspace owner
   `/bindgroup` çalıştırır → bot kullanıcıyı DM'de yönlendirir,
   sahip olduğu workspace'lerden birini seçer. Bir grup ↔ bir
   workspace; bir workspace ↔ bir grup.
3. **Üyelik gerekir**: grup'ta bot'a mention atan kullanıcı O
   workspace'in **üyesi** olmalı. Sadece grup üyesi olmak yetmez —
   davet ayrıca yapılır (Mini App → Workspace settings → Üyeler veya
   DM'den `/share`).

Kullanım pattern'leri (grup içinde):

```
@listbull_bot süt yumurta peynir
  → invoker'ın bağlı workspace'inin Inbox'ına 3 item

(Ali'nin "Thanksgiving düzenleyelim" mesajına reply atarak)
@listbull_bot bunu listeye ekle
  → "Thanksgiving düzenleyelim" Inbox'a düşer
```

Bot grup'ta yalnız @-mention + komut + bot mesajlarına gelen
reply'leri görür (privacy mode AÇIK); diğer mesajlar LLM'e
gitmez.

OpenRouter maliyetini **workspace sahibi karşılar** — bağlanan
workspace'in org-key'i her LLM call için kullanılır.

Bot'u grup'tan çıkarırsan binding **otomatik temizlenir**
(`my_chat_member` handler). Yeniden eklersen `/bindgroup` ile
yeniden bağlamak gerekir.

---

## Yedekleme

Postgres dump cron'u önerilir:

```bash
# /etc/cron.d/listbull-backup veya systemd timer
0 * * * * docker exec listbull-postgres pg_dump -U listbull listbull \
  | gzip > /backups/listbull-$(date +\%Y\%m\%d-\%H).sql.gz
```

Backup destination önerisi: Hetzner Storage Box, Backblaze B2 veya
benzeri S3-uyumlu obje depo.

---

## Attachment'lar nasıl saklanır

listbull dosyaları **kendi sunucunda saklamaz**. Bot intake aldığında
sadece `telegram_file_id` (Telegram'ın CDN referansı) DB'ye yazılır;
dosyanın kendisi Telegram'ın altyapısında durur. Avantajı: sıfır disk +
sıfır storage faturası.

Mini App içinde dosya görüntüleme:
- **≤20MB**: Bot API `getFile` çekip stream eder → lightbox preview
- **>20MB**: Bot API limiti nedeniyle preview yok. Lightbox typed icon
  + size etiketi gösterir, **"Telegram'a yolla"** butonu (file_id ile
  `sendDocument/sendPhoto` — size limiti yok) dosyayı bot DM'inize geri
  iletir; orada Telegram client native save / forward / open with
  affordance'larını kullanırsın.

⚠️ **Bot token rotation = attachment loss.** Telegram'da bot
yeniden yaratırsan veya `/revoke` ile token değiştirirsen tüm eski
`telegram_file_id` değerleri **geçersiz olur**. Bu Telegram Bot API'nın
yapısal sınırı; listbull'un kontrolü dışında. Plan:
- BotFather'da bot token'ını rotate etmeden önce kullanıcılara haber ver.
- Kritik attachment'lar varsa kullanıcılar Telegram client içinde bot
  DM'inden manual `Save to gallery` yapabilir.
- DB pg_dump backup'ları bu sorunu **çözmez** — sadece metadata
  korunur, dosyalar Telegram tarafında.

---

## Güncellemek

```bash
cd ~/listbull
git pull
docker compose build app cron
docker compose up -d
docker compose run --rm app npm run db:migrate
```

Migration'lar idempotent — daha önce uygulanmışlar tekrar koşmaz.

---

## Yardım

- Issue açmak: https://github.com/buraksu42/listbull/issues
- Architecture deep-dive: `handoff/specs/architecture.md`
- Contributing: `CONTRIBUTING.md`

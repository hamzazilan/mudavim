# Müdavim — Firebase Kurulumu

Giriş sistemi ve herkesin aynı veriyi görmesi için ücretsiz bir Firebase projesi gerekiyor.
Bu adımlar yaklaşık 10 dakika sürer ve **bir kez** yapılır.

## 1. Proje oluştur
1. https://console.firebase.google.com adresine Google hesabınla gir.
2. **Proje ekle** → ad: `mudavim` → Google Analytics'i kapatabilirsin → **Proje oluştur**.

## 2. Giriş yöntemlerini aç
1. Sol menü: **Build → Authentication → Başlayın**.
2. **Sign-in method** sekmesinde:
   - **E-posta/Şifre** → Etkinleştir → Kaydet.
   - **Google** → Etkinleştir → destek maili olarak kendi mailini seç → Kaydet.

## 3. Veritabanını oluştur
1. Sol menü: **Build → Firestore Database → Veritabanı oluştur**.
2. Konum: `eur3 (europe-west)` → **Üretim modunda başlat**.
3. **Kurallar (Rules)** sekmesine geç, içindekileri sil ve bu klasördeki
   `firestore.rules` dosyasının tamamını yapıştır.
4. Dosyadaki admin listesine admin maillerini yaz (küçük harfle), örneğin:
   ```
   && request.auth.token.email.lower() in [
     "ofa@gmail.com", "baskaadmin@gmail.com"
   ];
   ```
5. **Yayınla**.

## 4. Web uygulamasını bağla
1. Sol üstteki dişli → **Proje ayarları → Genel**.
2. Aşağıda **Uygulamalarınız → `</>` (Web)** → takma ad `mudavim-web` → **Uygulamayı kaydet**.
3. Çıkan `firebaseConfig` içindeki değerleri `config.js` dosyasındaki `firebase: { ... }`
   kısmına kopyala.
4. Aynı admin maillerini `config.js` içindeki `adminEmails` listesine de yaz.

> `apiKey` gizli bir şifre değildir, sitede görünmesi normaldir. Güvenliği
> `firestore.rules` sağlar.

## 5. Site adresini yetkilendir
**Authentication → Settings → Authorized domains → Add domain** →
`KULLANICIADI.github.io` (GitHub Pages adresin).

> Not: Giriş, `index.html` dosyasına çift tıklayarak açınca çalışmaz;
> siteyi GitHub Pages adresinden açmak gerekir.

## 6. İlk açılış
1. Siteyi aç, **Giriş yap** → admin mailinle kaydol.
   - Mail/şifre ile kaydolduysan gelen doğrulama mailindeki bağlantıya tıkla,
     sonra **Hesabım → Doğruladım**.
   - Google ile girdiysen doğrulama gerekmez.
2. Menüde **Veri Gir** ve **Üyeler** görünür.
3. **Veri Gir → Verileri Firebase'e yükle** ile `data.js`'teki oyuncuları ve
   sezonları bir kereliğine veritabanına aktar.

## Nasıl işliyor?
| Kim | Ne yapabilir |
|---|---|
| Herkes (girişsiz) | Sıralama, sezonlar, maçlar ve oyuncu sayfalarını görür |
| Kayıt olan | "Onay bekliyor" durumunda bekler |
| Onaylı üye | Mevcut bir oyuncuyu kendine bağlar ya da kendi adıyla yeni profil açar |
| Admin | Maç, sezon, oyuncu girer; üyeleri onaylar/reddeder |

Admin eklemek/çıkarmak için hem `firestore.rules` hem `config.js` içindeki listeyi güncelle.

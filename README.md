# SubGame Launcher & DRM Xavfsizlik Tizimi

**SubGame** rasmiy Windows ish stoli launcheri va o'zbekcha o'yin lokalizatsiyalarini himoyalash (DRM) tizimi.

---

## 🎯 Asosiy Vazifalari

1. **1 Qurilma = 1 Nusxa (Hardware ID Binding):**
   - Foydalanuvchi kompyuterining ona platasi, protsessori va BIOS seriya raqamlaridan takrorlanmas HWID (`SG-XXXX-XXXX-XXXX-XXXX`) olinadi.
   - Har bir xaridorga berilgan faollashtirish kaliti faqat uning kompyuteriga biriktiriladi.
2. **AES-256 Kriptografik Himoya:**
   - Subtitr fayllari (`tt01.pc` va h.k.) ochiq holda kompyuterda saqlanmaydi. Ular maxsus shifrlangan holatda bo'ladi.
   - Foydalanuvchi Launcherdan o'yinni boshlagandagina fayllar xavfsiz dekodlanadi va o'yin yopilgach tozalab olinadi.
3. **Zamonaviy Gaming UI:**
   - SubGame brendiga mos, qora premium fon, neon effektlar, o'yin posterlari va statuslar.
   - O'yin `.exe` faylini avtomatik saqlab qolish va 1 bosishda o'zbekcha ishga tushirish.

---

## 🚀 Ishga tushirish (Development)

```bash
# Elektron dasturni to'liq qurish
npm run build

# Launcherni ishga tushirish
npm start
```

---

## 🔑 Admin Asboblari (Litsenziya Kalitlari Yaratish)

Mijoz o'yin sotib olganda unga kalit generatsiya qilib berish:

```bash
# Innocence uchun 5 ta kalit yaratish
node tools/keygen.js inno 5

# Requiem uchun 3 ta kalit yaratish
node tools/keygen.js requ 3

# Outward 2 uchun kalit yaratish
node tools/keygen.js outw 1
```

Namuna kalit:
`SUB-INNO-GSHW-EBF4`

---

## 📦 Windows `.exe` Dasturini Tayyorlash (Production)

Mijozlarga berish uchun bitta portable `.exe` fayl yasash:

```bash
npm run dist:win
```

Tayyor `.exe` fayl `release/` papkasida paydo bo'ladi.

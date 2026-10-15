<div dir="rtl">

# 🌍 مدار · Madar Live

**خريطة عالم ثلاثية الأبعاد حية:** رحلات طيران، زلازل، أقمار صناعية وطقس — كلها على كرة أرضية تفاعلية في المتصفح.

<p>
  <a href="https://tmrsa1-ui.github.io/madar-live/"><img src="https://img.shields.io/badge/%D8%AC%D8%B1%D9%91%D8%A8%20%D8%A7%D9%84%D8%A2%D9%86-Live%20Demo-0b7285?style=for-the-badge" alt="جرّب الآن"></a>
  <img src="https://img.shields.io/badge/React-19-20232A?style=flat-square&logo=react" alt="React 19">
  <img src="https://img.shields.io/badge/Vite-7-646CFF?style=flat-square&logo=vite&logoColor=white" alt="Vite 7">
  <img src="https://img.shields.io/badge/Three.js-globe.gl-000?style=flat-square&logo=threedotjs" alt="Three.js">
  <img src="https://img.shields.io/badge/deck.gl-9.4-1f6feb?style=flat-square" alt="deck.gl">
</p>

## ✨ وش فيه

| الطبقة | المصدر | التفاصيل |
|---|---|---|
| ✈️ رحلات الطيران | OpenSky Network | مواقع الطائرات الحية مع مسار الرحلة والتفاصيل |
| 🌋 الزلازل | USGS | آخر الزلازل حسب القوة والموقع |
| 🛰️ الأقمار الصناعية | CelesTrak (TLE) | مدارات محسوبة في المتصفح عبر `satellite.js` |
| 🌦️ الطقس | Open-Meteo | حالة الطقس لأي نقطة على الخريطة |

- عرضان: كرة ثلاثية الأبعاد وخريطة مسطحة.
- بحث عن الدول والرحلات، ولوحة طبقات تتحكم بالظاهر.
- واجهة عربية وإنجليزية (`src/i18n`).
- نسخة «عرض تجريبي» تعمل بلا إنترنت ببيانات محلية (`npm run build:demo`).

## 🚀 التشغيل

```bash
npm ci
npm run dev        # خادم التطوير
npm run build      # بناء الإنتاج
npm run build:demo # نسخة ملف واحد تعمل بلا شبكة
```

### متغيرات البيئة (اختيارية)

انسخ `.env.example` إلى `.env`. بدون مفاتيح يستخدم الوكيل وصول OpenSky المجهول (حد يومي أقل).

| المتغير | الغرض |
|---|---|
| `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` | عميل OpenSky OAuth2 لرفع حدود الطلبات |

## 🗂️ البنية

```
src/
  components/   واجهة: الكرة، الخريطة المسطحة، لوحة الطبقات، البحث، التفاصيل
  services/     جلب البيانات: الرحلات، الزلازل، الأقمار، الطقس
  workers/      حسابات ثقيلة خارج الخيط الرئيسي
  store/        حالة التطبيق (zustand)
api/            وكلاء خادمية: opensky، route، tle
server/         وسيط التطوير المحلي
```

## 🌐 النشر

يُبنى ويُنشر تلقائيًا على GitHub Pages عبر GitHub Actions عند الدفع إلى `main`. يدعم أيضًا Netlify وVercel (`netlify.toml`، `vercel.json`).

## 🙏 مصادر البيانات

بيانات الطيران من [OpenSky Network](https://opensky-network.org)، الزلازل من [USGS](https://earthquake.usgs.gov)، المدارات من [CelesTrak](https://celestrak.org)، والطقس من [Open-Meteo](https://open-meteo.com). كل مصدر خاضع لشروط استخدامه.

</div>

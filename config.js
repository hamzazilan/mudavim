// =====================================================================
//  SİTE AYARLARI
//  Kurulum adımları için KURULUM.md dosyasına bak.
// =====================================================================

window.MUDAVIM_CONFIG = {
  // Firebase konsolu > Proje ayarları > "Uygulamalarınız" > Web uygulaması
  // bölümündeki firebaseConfig değerlerini buraya yapıştır.
  // apiKey "BURAYA" ile başladığı sürece site Firebase'siz (sadece bu
  // tarayıcıya kaydeden) modda çalışır.
  firebase: {
    apiKey: "AIzaSyBRmHUByHrJPRoB1oFr2LmO2n1IyEw0L34",
    authDomain: "mudavim-1884o.firebaseapp.com",
    projectId: "mudavim-1884o",
    storageBucket: "mudavim-1884o.firebasestorage.app",
    messagingSenderId: "963758107741",
    appId: "1:963758107741:web:7f21a44d759f408de931b4",
  },

  // Bu adreslerle kaydolup mailini doğrulayan kişiler otomatik admin olur.
  // ÖNEMLİ: Aynı listeyi firestore.rules dosyasına da yazmalısın;
  // asıl yetki kontrolünü orası yapar.
  adminEmails: [
    "hamzazilan34@gmail.com",
    "gokbarazomerfaruk@gmail.com",
  ],
};

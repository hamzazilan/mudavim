// =====================================================================
//  MÜDAVİM VERİ DOSYASI
//  Sitenin başlangıç verisi. Sitedeki "Veri Gir" sayfasından yapılan
//  değişiklikler tarayıcıya kaydedilir; "Dışa aktar" ile bu dosyanın
//  güncel hali indirilip buraya konabilir.
// =====================================================================

window.MUDAVIM = {
  club: { name: "İEL Halı Saha Müdavimleri", city: "Münih" },

  // ---------------------------------------------------------------
  //  OYUNCULAR   id: benzersiz kısa ad (URL'de kullanılır)
  // ---------------------------------------------------------------
  players: [
    { id: "ofa", name: "Öfa" },
    { id: "hamza-zilan", name: "Hamza Zilan" },
    { id: "murat-aksoy", name: "Murat Aksoy" },
    { id: "emirhan", name: "Emirhan" },
    { id: "muhtar", name: "Muhtar" },
    { id: "suat", name: "Suat" },
    { id: "ibrahim-bastug", name: "İbrahim Baştuğ" },
    { id: "hasan-cagri", name: "Hasan Çağrı" },
    { id: "atakan", name: "Atakan" },
    { id: "kadir", name: "Kadir" },
    { id: "baran-20", name: "Baran 20" },
    { id: "arda-doyran", name: "Arda Doyran" },
    { id: "ihsan", name: "İhsan" },
    { id: "alper", name: "Alper" },
    { id: "emre-tuzmen", name: "Emre Tüzmen" },
    { id: "ataberk", name: "Ataberk" },
    { id: "tuna", name: "Tuna" },
    { id: "fatih-bora", name: "Fatih Bora" },
    { id: "mehmet-efe", name: "Mehmet Efe" },
    { id: "balp", name: "Balp" },
    { id: "gokalp", name: "Gökalp" },
    { id: "ibrahim-karadag", name: "İbrahim Karadağ" },
    { id: "omer-akar", name: "Ömer Akar" },
    { id: "kaan-tozlu", name: "Kaan Tozlu" },
    { id: "emre-19", name: "Emre 19" },
    { id: "kaykac", name: "Kaykaç" },
    { id: "eren-abi", name: "Eren Abi" },
    { id: "taha-bilgic", name: "Taha Bilgiç Abi" },
    { id: "ismail", name: "İsmail" },
    { id: "sadik", name: "Sadık" },
    { id: "umit", name: "Ümit" },
    { id: "selcuk", name: "Selçuk" },
    { id: "onti", name: "Onti" },
    { id: "caner", name: "Caner" },
    { id: "arda-ayvacik", name: "Arda Ayvacık" },
    { id: "yagiz-turgut", name: "Yağız Turgut" },
    { id: "alpcan", name: "Alpcan" },
    { id: "cagatay", name: "Çağatay" },
    { id: "sevki-burak", name: "Şevki Burak" },
    { id: "batuhan-abi", name: "Batuhan Abi" },
    { id: "gorkem", name: "Görkem" },
    { id: "fmb", name: "FMB" },
    { id: "yilkut-aydin", name: "Yılkut Aydın" },
    { id: "eren-abi-18", name: "Eren Abi 18" },
    { id: "omer-ahi", name: "Ömer Ahi" },
    { id: "furkan-abi", name: "Furkan Abi" },
    { id: "arda-yoldas", name: "Arda Yoldaş" },
  ],

  // ---------------------------------------------------------------
  //  SEZONLAR   (listenin sonundaki sezon = güncel sezon)
  //  legacy: maç detayı olmayan, toplam olarak girilmiş eski veriler
  //          { oyuncuId: { played: maç, won: galibiyet } }
  // ---------------------------------------------------------------
  seasons: [
    {
      id: "ws25-26",
      name: "WS25/26",
      note: "Excel'den aktarılan toplamlar (maç detayı yok)",
      legacy: {
        "ofa": { played: 50, won: 29 },
        "hamza-zilan": { played: 49, won: 27 },
        "murat-aksoy": { played: 47, won: 28 },
        "emirhan": { played: 40, won: 22 },
        "muhtar": { played: 34, won: 16 },
        "suat": { played: 30, won: 20 },
        "ibrahim-bastug": { played: 26, won: 18 },
        "hasan-cagri": { played: 23, won: 16 },
        "atakan": { played: 23, won: 15 },
        "kadir": { played: 22, won: 14 },
        "baran-20": { played: 19, won: 10 },
        "arda-doyran": { played: 19, won: 7 },
        "ihsan": { played: 17, won: 14 },
        "alper": { played: 17, won: 12 },
        "emre-tuzmen": { played: 15, won: 12 },
        "ataberk": { played: 14, won: 10 },
        "tuna": { played: 14, won: 8 },
        "fatih-bora": { played: 14, won: 6 },
        "mehmet-efe": { played: 13, won: 7 },
        "balp": { played: 12, won: 6 },
        "gokalp": { played: 12, won: 6 },
        "ibrahim-karadag": { played: 12, won: 5 },
        "omer-akar": { played: 11, won: 7 },
        "kaan-tozlu": { played: 10, won: 8 },
        "emre-19": { played: 10, won: 5 },
        "kaykac": { played: 9, won: 6 },
        "eren-abi": { played: 8, won: 7 },
        "taha-bilgic": { played: 8, won: 3 },
        "ismail": { played: 7, won: 7 },
        "sadik": { played: 7, won: 5 },
        "umit": { played: 7, won: 3 },
        "selcuk": { played: 6, won: 5 },
        "onti": { played: 5, won: 2 },
        "caner": { played: 4, won: 3 },
        "arda-ayvacik": { played: 4, won: 3 },
        "yagiz-turgut": { played: 4, won: 1 },
        "alpcan": { played: 3, won: 3 },
        "cagatay": { played: 3, won: 2 },
        "sevki-burak": { played: 2, won: 2 },
        "batuhan-abi": { played: 2, won: 1 },
        "gorkem": { played: 2, won: 1 },
        "fmb": { played: 2, won: 1 },
        "yilkut-aydin": { played: 1, won: 1 },
        "eren-abi-18": { played: 1, won: 1 },
        "omer-ahi": { played: 1, won: 1 },
        "furkan-abi": { played: 1, won: 0 },
        "arda-yoldas": { played: 1, won: 0 },
      },
    },
  ],

  // ---------------------------------------------------------------
  //  MAÇLAR
  //  { id, season, date: "YYYY-MM-DD",
  //    home: { name, players: [id...] }, away: { name, players: [id...] },
  //    score: [ev, deplasman] }
  // ---------------------------------------------------------------
  matches: [],
};

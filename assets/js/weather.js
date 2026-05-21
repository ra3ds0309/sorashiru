// 全27都市の気象庁データURLと地図上の座標
const targetCities = [
  { "name": "旭川", "url": "https://www.jma.go.jp/bosai/forecast/data/forecast/012000.json", "x": 1480, "y": 120 },
  { "name": "札幌", "url": "https://www.jma.go.jp/bosai/forecast/data/forecast/016000.json", "x": 1420, "y": 200 },
  { "name": "青森", "url": "https://www.jma.go.jp/bosai/forecast/data/forecast/020000.json", "x": 1340, "y": 300 },
  { "name": "盛岡", "url": "https://www.jma.go.jp/bosai/forecast/data/forecast/030000.json", "x": 1350, "y": 350 },
  { "name": "仙台", "url": "https://www.jma.go.jp/bosai/forecast/data/forecast/040000.json", "x": 1280, "y": 420 },
  { "name": "山形", "url": "https://www.jma.go.jp/bosai/forecast/data/forecast/060000.json", "x": 1240, "y": 420 },
  { "name": "水戸", "url": "https://www.jma.go.jp/bosai/forecast/data/forecast/080000.json", "x": 1240, "y": 550 },
  { "name": "宇都宮", "url": "https://www.jma.go.jp/bosai/forecast/data/forecast/090000.json", "x": 1200, "y": 540 },
  { "name": "東京", "url": "https://www.jma.go.jp/bosai/forecast/data/forecast/130000.json", "x": 1180, "y": 620 },
  { "name": "伊豆諸島", "url": "https://www.jma.go.jp/bosai/forecast/data/forecast/130000.json", "x": 1180, "y": 740 },
  { "name": "小笠原諸島", "url": "https://www.jma.go.jp/bosai/forecast/data/forecast/130000.json", "x": 1280, "y": 920 },
  { "name": "静岡", "url": "https://www.jma.go.jp/bosai/forecast/data/forecast/220000.json", "x": 1100, "y": 660 },
  { "name": "長野", "url": "https://www.jma.go.jp/bosai/forecast/data/forecast/200000.json", "x": 1120, "y": 570 },
  { "name": "金沢", "url": "https://www.jma.go.jp/bosai/forecast/data/forecast/170000.json", "x": 1030, "y": 540 },
  { "name": "名古屋", "url": "https://www.jma.go.jp/bosai/forecast/data/forecast/230000.json", "x": 1020, "y": 650 },
  { "name": "大阪", "url": "https://www.jma.go.jp/bosai/forecast/data/forecast/270000.json", "x": 920, "y": 680 },
  { "name": "高松", "url": "https://www.jma.go.jp/bosai/forecast/data/forecast/370000.json", "x": 820, "y": 740 },
  { "name": "高知", "url": "https://www.jma.go.jp/bosai/forecast/data/forecast/390000.json", "x": 800, "y": 790 },
  { "name": "松江", "url": "https://www.jma.go.jp/bosai/forecast/data/forecast/320000.json", "x": 780, "y": 660 },
  { "name": "山口", "url": "https://www.jma.go.jp/bosai/forecast/data/forecast/350000.json", "x": 680, "y": 710 },
  { "name": "福岡", "url": "https://www.jma.go.jp/bosai/forecast/data/forecast/400000.json", "x": 620, "y": 720 },
  { "name": "熊本", "url": "https://www.jma.go.jp/bosai/forecast/data/forecast/430000.json", "x": 580, "y": 790 },
  { "name": "鹿児島", "url": "https://www.jma.go.jp/bosai/forecast/data/forecast/460100.json", "x": 560, "y": 850 },
  { "name": "奄美", "url": "https://www.jma.go.jp/bosai/forecast/data/forecast/460100.json", "x": 450, "y": 950 },
  { "name": "那覇", "url": "https://www.jma.go.jp/bosai/forecast/data/forecast/471000.json", "x": 300, "y": 900 },
  { "name": "大東島", "url": "https://www.jma.go.jp/bosai/forecast/data/forecast/472000.json", "x": 400, "y": 920 },
  { "name": "石垣島", "url": "https://www.jma.go.jp/bosai/forecast/data/forecast/474000.json", "x": 200, "y": 980 }
];

// ページが読み込まれたら自動的に天気を取得してマップにピンを刺す
document.addEventListener("DOMContentLoaded", async () => {
  const mapContainer = document.getElementById("weather-map"); // HTML側の地図コンテナ
  if (!mapContainer) return;

  console.log("気象庁から最新の天気を直接取得中...");

  for (const city of targetCities) {
    try {
      // 🌐 ブラウザから直接気象庁のAPIを叩く
      const response = await fetch(city.url);
      const json = await response.getJson ? await response.getJson() : await response.json();
      
      const forecastBlock = json[0];
      const timeSeries = forecastBlock.timeSeries;
      
      let areaData = timeSeries[0].areas.find(a => a.area.name.includes(city.name) || city.name.includes(a.area.name));
      if (!areaData) areaData = timeSeries[0].areas[0];
      
      const weatherCode = areaData.weatherCodes[0]; // 天気コード

      let tempMin = "--";
      let tempMax = "--";
      if (timeSeries[2]) {
        let tempAreaData = timeSeries[2].areas.find(a => a.area.name.includes(city.name) || city.name.includes(a.area.name));
        if (!tempAreaData) tempAreaData = timeSeries[2].areas[0];
        if (tempAreaData && tempAreaData.temps) {
          tempMin = tempAreaData.temps[0] || "--";
          tempMax = tempAreaData.temps[1] || "--";
        }
      }

      // 📍 取得したデータをもとに、画面上にピン（HTML要素）を動的につくる
      const pin = document.createElement("div");
      pin.className = "weather-pin";
      pin.style.left = `${city.x}px`;
      pin.style.top = `${city.y}px`;
      pin.style.position = "absolute";
      
      // ピンの中身（デザインは既存のCSSに合わせて調整してください）
      pin.innerHTML = `
        <div class="pin-window">
          <p class="city-name">${city.name}</p>
          <img src="assets/images/weather/${weatherCode}.png" alt="weather" class="weather-icon" onerror="this.src='assets/images/weather/unknown.png'">
          <p class="temp"><span class="max">${tempMax}°C</span> / <span class="min">${tempMin}°C</span></p>
        </div>
      `;
      
      mapContainer.appendChild(pin);

    } catch (error) {
      console.error(`${city.name}の天気取得に失敗しました:`, error);
    }
  }
});

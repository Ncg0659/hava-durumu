/* Hava durumu ikonları: bu projede çizilmiş özgün SVG'ler (üçüncü taraf ikon kodu yok).
   Meteocons (MIT) eklenince bu dosyadaki weatherIcon() fonksiyonu onun dosyalarını gösterecek şekilde değiştirilecek. */
'use strict';
(function (global) {
  // --- Parçalar (64x64 çizim alanı) ---
  function sun(cx, cy, s) {
    var r = 11 * s, rays = '';
    for (var i = 0; i < 8; i++) {
      var a = (i * Math.PI) / 4, r1 = 16 * s, r2 = 21 * s;
      rays += '<line x1="' + (cx + Math.cos(a) * r1).toFixed(1) + '" y1="' + (cy + Math.sin(a) * r1).toFixed(1) +
        '" x2="' + (cx + Math.cos(a) * r2).toFixed(1) + '" y2="' + (cy + Math.sin(a) * r2).toFixed(1) + '"/>';
    }
    return '<g class="spin" style="transform-origin:' + cx + 'px ' + cy + 'px" stroke="#FFC93C" stroke-width="3.2" stroke-linecap="round">' + rays + '</g>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="#FFC93C"/>';
  }
  function moon(cx, cy, s) {
    return '<g transform="translate(' + (cx - 26 * s) + ' ' + (cy - 26 * s) + ') scale(' + s + ')">' +
      '<path d="M34 6A22 22 0 1 0 54 40A17 17 0 0 1 34 6Z" fill="#F3EFC8"/></g>';
  }
  function stars(list) {
    return list.map(function (p, i) {
      return '<circle class="tw" style="animation-delay:' + (i * 0.7) + 's" cx="' + p[0] + '" cy="' + p[1] + '" r="1.6" fill="#fff"/>';
    }).join('');
  }
  function cloud(tx, ty, s, fill) {
    return '<g class="cf" ><g transform="translate(' + tx + ' ' + ty + ') scale(' + s + ')" fill="' + fill + '">' +
      '<circle cx="22" cy="35" r="9"/><circle cx="33" cy="29" r="13"/><circle cx="45" cy="35" r="9"/>' +
      '<rect x="22" y="35" width="23" height="9" rx="4.5"/></g></g>';
  }
  function drops(xs, y, color) {
    return xs.map(function (x, i) {
      return '<line class="drop" style="animation-delay:' + (i * 0.22) + 's" x1="' + x + '" y1="' + y + '" x2="' + (x - 2) + '" y2="' + (y + 6) +
        '" stroke="' + color + '" stroke-width="3" stroke-linecap="round"/>';
    }).join('');
  }
  function flakes(xs, y) {
    return xs.map(function (x, i) {
      return '<circle class="flake" style="animation-delay:' + (i * 0.5) + 's" cx="' + x + '" cy="' + (y + (i % 2) * 4) + '" r="2.2" fill="#fff"/>';
    }).join('');
  }
  function bolt() {
    return '<polygon class="flash" points="34,41 26,54 33,54 30,63 42,48 35,48 39,41" fill="#FFD23F"/>';
  }

  var LIGHT = '#EDF3F9', GREY = '#B4C2D0', DARK = '#8394A8';

  function body(kind, day) {
    switch (kind) {
      case 'clear':
        return day ? sun(32, 32, 1.05)
          : moon(32, 32, 1.05) + stars([[12, 14], [52, 12], [50, 50]]);
      case 'partly':
        return (day ? sun(24, 24, 0.8) : moon(23, 23, 0.85) + stars([[48, 12]])) + cloud(8, 10, 0.95, LIGHT);
      case 'cloudy':
        return cloud(-2, 2, 0.8, GREY) + cloud(8, 12, 0.95, LIGHT);
      case 'overcast':
        return cloud(-2, 2, 0.85, DARK) + cloud(8, 12, 0.95, GREY);
      case 'fog':
        return cloud(3, 0, 0.95, LIGHT) +
          '<g class="mist" stroke="#DCE5EC" stroke-width="3" stroke-linecap="round"><line x1="14" y1="48" x2="46" y2="48"/><line x1="20" y1="54" x2="52" y2="54"/><line x1="12" y1="60" x2="38" y2="60"/></g>';
      case 'drizzle':
        return cloud(3, -2, 0.95, LIGHT) + drops([24, 34, 44], 47, '#7CCBFF');
      case 'rain':
        return cloud(3, -4, 0.95, GREY) + drops([22, 31, 40, 49], 46, '#4DB8FF');
      case 'heavy':
        return cloud(3, -4, 0.95, DARK) + drops([19, 27, 35, 43, 51], 46, '#3AA6F5');
      case 'showers':
        return (day ? sun(22, 20, 0.7) : moon(21, 20, 0.75)) + cloud(8, 4, 0.9, GREY) + drops([24, 33, 42], 46, '#4DB8FF');
      case 'sleet':
        return cloud(3, -4, 0.95, GREY) + drops([22, 40], 46, '#4DB8FF') + flakes([31, 49], 48);
      case 'snow':
        return cloud(3, -4, 0.95, LIGHT) + flakes([21, 31, 41, 51], 47);
      case 'storm':
        return cloud(3, -6, 0.95, DARK) + bolt() + drops([20, 48], 47, '#4DB8FF');
      default:
        return cloud(3, 0, 1, LIGHT);
    }
  }

  // anim=true: hareketli (ana kart), false: sabit (listeler, performans için)
  function weatherIcon(kind, day, size, anim) {
    return '<svg class="ic' + (anim ? ' anim' : '') + '" viewBox="0 0 64 64" width="' + size + '" height="' + size +
      '" aria-hidden="true" focusable="false">' + body(kind, day) + '</svg>';
  }

  // --- Küçük arayüz ikonları (24x24, çizgi) ---
  var UI = {
    drop: '<path d="M12 3.5c3 4 6 7 6 10.5a6 6 0 0 1-12 0C6 10.5 9 7.5 12 3.5z"/>',
    wind: '<path d="M3 9h11a2.5 2.5 0 1 0-2.5-2.5"/><path d="M3 13h15a3 3 0 1 1-3 3"/><path d="M3 17h7"/>',
    umbrella: '<path d="M3 12a9 9 0 0 1 18 0H3z"/><path d="M12 12v6.5a2 2 0 0 1-4 0"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
    sunrise: '<path d="M2 19h20M7 19a5 5 0 0 1 10 0M12 4v7M9 7l3-3 3 3"/>',
    sunset: '<path d="M2 19h20M7 19a5 5 0 0 1 10 0M12 4v7M9 8l3 3 3-3"/>',
    thermo: '<path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z"/>',
    arrow: '<path d="M12 20V4M6 10l6-6 6 6"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9L3.5 9.7l5.9-.8L12 3.5z"/>',
    jacket: '<path d="M8 3L3 6.5l2.2 4L8 9v12h8V9l2.8 1.5 2.2-4L16 3a4 4 0 0 1-8 0z"/><path d="M12 7v14"/>',
    snowflake: '<path d="M12 3v18M5 7.5l14 9M5 16.5l14-9M9.5 4.5L12 7l2.5-2.5M9.5 19.5L12 17l2.5 2.5"/>',
    bolt: '<path d="M13 3L5 13.5h6L10 21l8-11h-6l1-7z"/>',
    smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.2a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    // Aşama 2 (hepsi bu projede çizilmiş özgün çizgi ikonlar)
    coffee: '<path d="M4.5 9h11v5.5a4.5 4.5 0 0 1-4.5 4.5h-2a4.5 4.5 0 0 1-4.5-4.5V9z"/><path d="M15.5 10.5h1.2a2.4 2.4 0 0 1 0 4.8h-1.2"/><path d="M8 3.5c0 1.3 1 1.4 1 2.7M12 3.5c0 1.3 1 1.4 1 2.7M3.5 21.5h13"/>',
    walk: '<circle cx="13" cy="4.5" r="1.8"/><path d="M10.5 9.5L13 8l2.4 2.6 2.4 1M13 8l-1.6 5.6 3.4 2.4 1 5M11.4 13.6L9 21"/>',
    run: '<circle cx="15" cy="4.5" r="1.8"/><path d="M14 8l-3.2 3.6 3.2 2.6-1.2 5.6M11 9.4L7.6 11M14.2 8.6l3.4 1.6 1.6 3M10.8 11.6L8 15.4 4.6 15.8"/>',
    bike: '<circle cx="6" cy="16" r="3.6"/><circle cx="18" cy="16" r="3.6"/><path d="M6 16l4-7h5l3 7M10 9l3 7H6M15 9l-1-2.2h-2.2"/>',
    basket: '<path d="M3.5 10h17l-1.6 9a1.6 1.6 0 0 1-1.6 1.3H6.7A1.6 1.6 0 0 1 5.1 19l-1.6-9z"/><path d="M8 10a4 4 0 0 1 8 0M9.8 13v4.2M14.2 13v4.2"/>',
    home: '<path d="M3.5 11.5L12 4l8.5 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>',
    mask: '<path d="M4 8h16v6a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6V8z"/><path d="M4 10.5H2M20 10.5h2M8 12.5h8M8 15.5h8"/>',
    leaf: '<path d="M5 19c0-8 5-13.5 14-14.5 0 9.500-5 14.500-13.500 14.500"/><path d="M5 19l8-8"/>',
    map: '<path d="M9 4L3 6.2v14L9 18l6 2.200 6-2.200v-14L15 6.200 9 4z"/><path d="M9 4v14M15 6.200v14"/>',
    play: '<path d="M8 5.500v13l11-6.500z"/>',
    pause: '<path d="M8.500 5.500v13M15.500 5.500v13"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    left: '<path d="M15 5l-7 7 7 7"/>',
    right: '<path d="M9 5l7 7-7 7"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.500M12 7.800h.01"/>',
    share: '<path d="M12 15V3.500M8 7l4-4 4 4"/><path d="M6 11H5a1.500 1.500 0 0 0-1.500 1.500v7A1.500 1.500 0 0 0 5 21h14a1.500 1.500 0 0 0 1.500-1.500v-7A1.500 1.500 0 0 0 19 11h-1"/>',
    download: '<path d="M12 3.500V15M8 11l4 4 4-4"/><path d="M4.500 19.500h15"/>',
    bell: '<path d="M6 16.500V11a6 6 0 0 1 12 0v5.500l1.500 2H4.500l1.500-2z"/><path d="M10 21h4"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.300 5.700"/><path d="M20 4.500V11h-6.500"/>'
  };
  function uiIcon(name, size, extraClass) {
    return '<svg class="ui' + (extraClass ? ' ' + extraClass : '') + '" viewBox="0 0 24 24" width="' + size + '" height="' + size +
      '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      UI[name] + '</svg>';
  }

  global.weatherIcon = weatherIcon;
  global.uiIcon = uiIcon;
})(window);

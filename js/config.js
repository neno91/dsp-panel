/* Default panel config for opening index.html directly (simulation mode). When served by the
   bridge or published to a screen, this file is generated from bridge/site.json – edit via /admin. */
window.PANEL_CONFIG = {
  "site": {
    "name": "DSP Panel",
    "area": ""
  },
  "views": [
    {
      "id": "zones",
      "label": "Soner",
      "icon": "home",
      "join": 7
    },
    {
      "id": "mixer",
      "label": "Mikser",
      "icon": "speaker",
      "join": 8
    }
  ],
  "sources": [
    {
      "id": "mic1",
      "input": 1,
      "name": "Microphone 1",
      "short": "Mic 1",
      "icon": "mic",
      "joinOffset": 0
    },
    {
      "id": "mic2",
      "input": 2,
      "name": "Microphone 2",
      "short": "Mic 2",
      "icon": "mic",
      "joinOffset": 1
    },
    {
      "id": "mic3",
      "input": 3,
      "name": "Microphone 3",
      "short": "Mic 3",
      "icon": "mic",
      "joinOffset": 2
    },
    {
      "id": "mic4",
      "input": 4,
      "name": "Microphone 4",
      "short": "Mic 4",
      "icon": "mic",
      "joinOffset": 3
    },
    {
      "id": "music1",
      "input": 5,
      "name": "Music 1",
      "short": "Music 1",
      "icon": "music",
      "joinOffset": 4
    },
    {
      "id": "music2",
      "input": 6,
      "name": "Music 2",
      "short": "Music 2",
      "icon": "music",
      "joinOffset": 5
    },
    {
      "id": "music3",
      "input": 7,
      "name": "Music 3",
      "short": "Music 3",
      "icon": "music",
      "joinOffset": 6
    },
    {
      "id": "radio",
      "input": 8,
      "name": "Radio",
      "icon": "radio",
      "joinOffset": 7
    },
    {
      "id": "in9",
      "input": 9,
      "name": "Input 9",
      "short": "In 9",
      "icon": "xlr",
      "joinOffset": 8
    },
    {
      "id": "in10",
      "input": 10,
      "name": "Input 10",
      "short": "In 10",
      "icon": "xlr",
      "joinOffset": 9
    }
  ],
  "levels": {
    "input": {
      "min": -36,
      "max": 6
    },
    "zone": {
      "min": -100,
      "max": -6
    }
  },
  "zones": [
    {
      "id": "zone1",
      "name": "Zone 1",
      "icon": "speaker",
      "select": 31,
      "volume": 31,
      "sourceJoinBase": 100
    },
    {
      "id": "zone2",
      "name": "Zone 2",
      "icon": "speaker",
      "select": 32,
      "volume": 32,
      "sourceJoinBase": 110
    },
    {
      "id": "zone3",
      "name": "Zone 3",
      "icon": "speaker",
      "select": 33,
      "volume": 33,
      "sourceJoinBase": 120
    },
    {
      "id": "zone4",
      "name": "Zone 4",
      "icon": "speaker",
      "select": 34,
      "volume": 34,
      "sourceJoinBase": 130
    }
  ],
  "groups": [
    {
      "id": "all",
      "name": "All zones",
      "zones": "*"
    }
  ],
  "sourceGroups": [
    {
      "id": "mics",
      "name": "All microphones",
      "icon": "mic",
      "mode": "toggle",
      "sources": [
        "mic1",
        "mic2",
        "mic3",
        "mic4"
      ]
    },
    {
      "id": "music",
      "name": "Music",
      "icon": "music",
      "mode": "exclusive",
      "sources": [
        "music1",
        "music2",
        "music3"
      ]
    }
  ],
  "theme": {
    "logo": "",
    "logoHeight": 58,
    "background": "",
    "veil": 1,
    "colors": {
      "bg0": "#041721",
      "bg1": "#062330",
      "bg2": "#0b3142",
      "bg3": "#124256",
      "bg4": "#1a556c",
      "accent": "#2689a8",
      "accentHi": "#4fb6d4",
      "active": "#f2b24a",
      "activeHi": "#ffd27a",
      "text": "#eef6f9",
      "textDim": "#a9c3cf",
      "textFaint": "#6f8f9d",
      "ok": "#58d48f",
      "down": "#ef6b5b"
    }
  },
  "mixer": [
    {
      "source": "mic1",
      "button": 21,
      "level": 21
    },
    {
      "source": "mic2",
      "button": 22,
      "level": 22
    },
    {
      "source": "mic3",
      "button": 23,
      "level": 23
    },
    {
      "source": "mic4",
      "button": 24,
      "level": 24
    },
    {
      "source": "music1",
      "button": 25,
      "level": 25
    },
    {
      "source": "music2",
      "button": 26,
      "level": 26
    },
    {
      "source": "music3",
      "button": 27,
      "level": 27
    },
    {
      "source": "radio",
      "button": 28,
      "level": 28
    },
    {
      "source": "in9",
      "button": 29,
      "level": 29
    },
    {
      "source": "in10",
      "button": 30,
      "level": 30
    }
  ],
  "transport": {
    "mode": "auto",
    "url": ""
  },
  "ui": {
    "volumeStepPercent": 5,
    "clock24h": true,
    "lang": "en",
    "zoneLayout": "scroll",
    "sourceLayout": "tiles",
    "analogMax": 65535
  }
};

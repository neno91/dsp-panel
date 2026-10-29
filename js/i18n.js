/* ------------------------------------------------------------------
   Panel texts – Norwegian (nb) and English (en).
   The language comes from the generated config (ui.lang; set under
   "Sted og panel" in /admin, or per screen). Names of zones, sources
   and groups are the installer's own and are not translated.
   ------------------------------------------------------------------ */
window.PANEL_I18N = {
  nb: {
    locale: "nb-NO",
    views: { zones: "Soner", mixer: "Mikser" },
    viewNav: "Visning",
    zonesTitle: "Soner", zonesLead: "Velg kilde og juster volum per sone",
    mixerTitle: "Mikser", mixerLead: "Inngangsnivå for mikrofoner og musikkilder",
    soundOn: "Lyd på", muted: "Dempet", volume: "Volum",
    zoneToggle: n => `${n}: lyd av/på`, zoneToggleHint: "Demp / slå på lyd i sonen",
    lower: "Lavere", higher: "Høyere",
    zoneVolume: n => `${n} volum`, zoneSources: n => `${n} kilder`, sourceGroups: n => `${n} kildegrupper`,
    sourceTo: (s, z) => `${s} til ${z}`, sourceIn: (s, g) => `${s} i ${g}`, level: n => `${n} nivå`,
    groups: "Grupper", newGroup: "Ny gruppe", groupName: "Gruppenavn", defaultGroupName: n => `Gruppe ${n}`,
    done: "Ferdig", edit: "Rediger", remove: "Slett", close: "Lukk",
    groupToggle: n => `${n}: alle av/på`, allZones: "Alle soner", muteAll: "Demp / slå på alle", sources: "Kilder",
    spread: "Sonene har ulikt volum – dra for å sette alle likt",
    pickZones: "Velg sonene som skal være med i gruppen.", emptyGroup: "Gruppen er tom. Trykk Rediger for å legge til soner.",
    onInAll: "Lyd på i alle", onInSome: "Lyd på i noen", allMuted: "Alle dempet",
    confirmDelete: n => `Slette «${n}»?`, yesDelete: "Ja, slett", cancel: "Avbryt",
    sim: "Simulering", connected: "DSP tilkoblet", noContact: "Ingen kontakt (DSP)",
  },
  en: {
    locale: "en-GB",
    views: { zones: "Zones", mixer: "Mixer" },
    viewNav: "View",
    zonesTitle: "Zones", zonesLead: "Pick sources and set the volume per zone",
    mixerTitle: "Mixer", mixerLead: "Input levels for microphones and music sources",
    soundOn: "Sound on", muted: "Muted", volume: "Volume",
    zoneToggle: n => `${n}: sound on/off`, zoneToggleHint: "Mute / unmute the zone",
    lower: "Lower", higher: "Higher",
    zoneVolume: n => `${n} volume`, zoneSources: n => `${n} sources`, sourceGroups: n => `${n} source groups`,
    sourceTo: (s, z) => `${s} to ${z}`, sourceIn: (s, g) => `${s} in ${g}`, level: n => `${n} level`,
    groups: "Groups", newGroup: "New group", groupName: "Group name", defaultGroupName: n => `Group ${n}`,
    done: "Done", edit: "Edit", remove: "Delete", close: "Close",
    groupToggle: n => `${n}: all on/off`, allZones: "All zones", muteAll: "Mute / unmute all", sources: "Sources",
    spread: "The zones differ in volume – drag to set them all alike",
    pickZones: "Choose the zones that belong to the group.", emptyGroup: "The group is empty. Press Edit to add zones.",
    onInAll: "Sound on in all", onInSome: "Sound on in some", allMuted: "All muted",
    confirmDelete: n => `Delete “${n}”?`, yesDelete: "Yes, delete", cancel: "Cancel",
    sim: "Simulation", connected: "DSP connected", noContact: "No contact (DSP)",
  },
};

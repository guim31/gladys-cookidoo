// -----------------------------------------------------------------------------
// Every text the integration shows, in the four languages of the Gladys
// interface (en, fr, de, es). German says "du", Spanish says "usted", like the
// rest of guim31's integrations; the vocabulary follows the Gladys interface.
//
//   - NAMES    : feature names, written once when the device is created, in
//                the language of the configuration (one table per language);
//   - STATES   : the text states (no recipe, empty list, subscription type),
//                same rule;
//   - TEXT     : fixed texts of the widgets and the Configuration screen,
//                multi-language objects the core localizes;
//   - MESSAGES : texts built from a value (action results, statuses);
//   - thrown() : a THROWN message reaches the screen as a plain string, the
//                core cannot localize it: the languages are joined.
//
// test/i18n.test.js checks the four languages, the lengths and the German
// "du" of every entry.
// -----------------------------------------------------------------------------

export const LANGS = ['en', 'fr', 'de', 'es'];

/** Feature names, by configuration language (≤ 40 characters). */
export const NAMES = {
  en: {
    remaining_items: 'Items to buy',
    checked_items: 'Checked items',
    shopping_list: 'Shopping list',
    today_recipes: "Today's recipes",
    today_recipes_count: "Number of today's recipes",
    today_total_time: "Time of today's recipes",
    subscription: 'Subscription',
    subscription_end: 'Subscription end',
    subscription_days_left: 'Subscription days left',
  },
  fr: {
    remaining_items: 'Articles à acheter',
    checked_items: 'Articles cochés',
    shopping_list: 'Liste de courses',
    today_recipes: 'Recettes du jour',
    today_recipes_count: 'Nombre de recettes du jour',
    today_total_time: 'Temps des recettes du jour',
    subscription: 'Abonnement',
    subscription_end: "Fin de l'abonnement",
    subscription_days_left: "Jours d'abonnement restants",
  },
  de: {
    remaining_items: 'Zu kaufende Artikel',
    checked_items: 'Abgehakte Artikel',
    shopping_list: 'Einkaufsliste',
    today_recipes: 'Rezepte von heute',
    today_recipes_count: 'Anzahl der Rezepte von heute',
    today_total_time: 'Zeit der Rezepte von heute',
    subscription: 'Abo',
    subscription_end: 'Abo-Ende',
    subscription_days_left: 'Verbleibende Abo-Tage',
  },
  es: {
    remaining_items: 'Artículos por comprar',
    checked_items: 'Artículos marcados',
    shopping_list: 'Lista de la compra',
    today_recipes: 'Recetas de hoy',
    today_recipes_count: 'Número de recetas de hoy',
    today_total_time: 'Tiempo de las recetas de hoy',
    subscription: 'Suscripción',
    subscription_end: 'Fin de la suscripción',
    subscription_days_left: 'Días de suscripción restantes',
  },
};

/** Text states, by configuration language (never empty: Gladys ignores an empty text). */
export const STATES = {
  en: {
    no_recipe: 'No recipe planned',
    empty_list: 'Empty list',
    no_end: 'None',
    REGULAR: 'Premium',
    TRIAL: 'Trial',
    NONE: 'Free',
  },
  fr: {
    no_recipe: 'Aucune recette prévue',
    empty_list: 'Liste vide',
    no_end: 'Aucune',
    REGULAR: 'Premium',
    TRIAL: 'Essai',
    NONE: 'Gratuit',
  },
  de: {
    no_recipe: 'Kein Rezept geplant',
    empty_list: 'Leere Liste',
    no_end: 'Keins',
    REGULAR: 'Premium',
    TRIAL: 'Testphase',
    NONE: 'Kostenlos',
  },
  es: {
    no_recipe: 'Ninguna receta prevista',
    empty_list: 'Lista vacía',
    no_end: 'Ninguna',
    REGULAR: 'Premium',
    TRIAL: 'Prueba',
    NONE: 'Gratuita',
  },
};

/** Fixed texts (multi-language objects). */
export const TEXT = {
  // Shopping list widget (tiles and buttons: 24 characters at most)
  toBuy: { en: 'To buy', fr: 'À acheter', de: 'Zu kaufen', es: 'Por comprar' },
  checked: { en: 'Checked', fr: 'Cochés', de: 'Abgehakt', es: 'Marcados' },
  badgeChecked: { en: 'Checked', fr: 'Coché', de: 'Abgehakt', es: 'Marcado' },
  add: { en: 'Add', fr: 'Ajouter', de: 'Hinzufügen', es: 'Añadir' },
  check: { en: 'Check', fr: 'Cocher', de: 'Abhaken', es: 'Marcar' },
  uncheck: { en: 'Uncheck', fr: 'Décocher', de: 'Zurücksetzen', es: 'Desmarcar' },
  clearChecked: {
    en: 'Clear checked',
    fr: 'Vider les cochés',
    de: 'Abgehakte löschen',
    es: 'Quitar marcados',
  },
  itemName: { en: 'Item', fr: 'Article', de: 'Artikel', es: 'Artículo' },
  listEmpty: {
    en: 'The shopping list is empty.',
    fr: 'La liste de courses est vide.',
    de: 'Die Einkaufsliste ist leer.',
    es: 'La lista de la compra está vacía.',
  },

  // Recipe of the day widget
  today: { en: 'Today', fr: "Aujourd'hui", de: 'Heute', es: 'Hoy' },
  nothingToday: {
    en: 'Nothing planned today.',
    fr: "Rien de prévu aujourd'hui.",
    de: 'Heute ist nichts geplant.',
    es: 'Nada previsto para hoy.',
  },
  comingUp: {
    en: 'Coming up this week',
    fr: 'À venir cette semaine',
    de: 'Diese Woche geplant',
    es: 'Próximamente esta semana',
  },
  nothingThisWeek: {
    en: 'No recipe planned this week: plan one in Cookidoo.',
    fr: 'Aucune recette prévue cette semaine : planifiez-en une dans Cookidoo.',
    de: 'Diese Woche ist kein Rezept geplant: plane eins in Cookidoo.',
    es: 'No hay ninguna receta prevista esta semana: planifique una en Cookidoo.',
  },
  openRecipe: {
    en: 'Open in Cookidoo',
    fr: 'Ouvrir dans Cookidoo',
    de: 'In Cookidoo öffnen',
    es: 'Abrir en Cookidoo',
  },
  customRecipe: {
    en: 'My recipe',
    fr: 'Ma recette',
    de: 'Mein Rezept',
    es: 'Mi receta',
  },

  // Shared by the widgets and the Configuration screen
  notConfigured: {
    en: 'Fill in the e-mail and the password of the Cookidoo account in the configuration.',
    fr: "Renseignez l'e-mail et le mot de passe du compte Cookidoo dans la configuration.",
    de: 'Gib die E-Mail und das Passwort des Cookidoo-Kontos in der Konfiguration ein.',
    es: 'Introduzca el correo electrónico y la contraseña de la cuenta Cookidoo en la configuración.',
  },
  initFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
    de: 'Die Initialisierung ist fehlgeschlagen, sieh dir die Logs der Integration an.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },

  // Why Cookidoo cannot be read, by error kind (connection status, widgets)
  auth: {
    en: 'Cookidoo refused the sign-in: check the e-mail and the password. If Cookidoo asks for a step (new terms, a check), sign in once on its website or app.',
    fr: "Cookidoo a refusé la connexion : vérifiez l'e-mail et le mot de passe. Si Cookidoo demande une étape (conditions, vérification), connectez-vous une fois sur son site ou son appli.",
    de: 'Cookidoo hat die Anmeldung abgelehnt: Prüfe E-Mail und Passwort. Verlangt Cookidoo einen Schritt (neue Bedingungen, Prüfung), melde dich einmal auf der Website oder in der App an.',
    es: 'Cookidoo ha rechazado el inicio de sesión: compruebe el correo y la contraseña. Si Cookidoo pide un paso (condiciones, verificación), inicie sesión una vez en su web o app.',
  },
  blocked: {
    en: 'Cookidoo refused the connection of the integration (anti-robot protection). New attempt in 30 minutes.',
    fr: "Cookidoo a refusé la connexion de l'intégration (protection anti-robot). Nouvel essai dans 30 minutes.",
    de: 'Cookidoo hat die Verbindung der Integration abgelehnt (Schutz vor Robotern). Neuer Versuch in 30 Minuten.',
    es: 'Cookidoo ha rechazado la conexión de la integración (protección antirrobots). Nuevo intento en 30 minutos.',
  },
  network: {
    en: 'Cookidoo cannot be reached: new attempt at the next refresh.',
    fr: 'Cookidoo est injoignable : nouvel essai au prochain rafraîchissement.',
    de: 'Cookidoo ist nicht erreichbar: neuer Versuch bei der nächsten Aktualisierung.',
    es: 'No se puede acceder a Cookidoo: nuevo intento en la próxima actualización.',
  },
  api: {
    en: 'Cookidoo answered in an unexpected format (its API may have changed): update the integration.',
    fr: "Cookidoo a répondu dans un format inattendu (son API a peut-être changé) : mettez à jour l'intégration.",
    de: 'Cookidoo hat in einem unerwarteten Format geantwortet (die API hat sich vielleicht geändert): Aktualisiere die Integration.',
    es: 'Cookidoo ha respondido con un formato inesperado (puede que su API haya cambiado): actualice la integración.',
  },

  // Short forms, joined by thrown(): a scene action error, a widget toast.
  authShort: {
    en: 'Cookidoo refused the sign-in.',
    fr: 'Cookidoo a refusé la connexion.',
    de: 'Cookidoo hat die Anmeldung abgelehnt.',
    es: 'Cookidoo ha rechazado el acceso.',
  },
  blockedShort: {
    en: 'Cookidoo refused the integration.',
    fr: "Cookidoo a refusé l'intégration.",
    de: 'Cookidoo hat die Integration abgelehnt.',
    es: 'Cookidoo ha rechazado la integración.',
  },
  networkShort: {
    en: 'Cookidoo unreachable.',
    fr: 'Cookidoo injoignable.',
    de: 'Cookidoo nicht erreichbar.',
    es: 'Cookidoo inaccesible.',
  },
  apiShort: {
    en: 'Unexpected Cookidoo answer.',
    fr: 'Réponse Cookidoo inattendue.',
    de: 'Unerwartete Cookidoo-Antwort.',
    es: 'Respuesta inesperada de Cookidoo.',
  },
  notConfiguredShort: {
    en: 'Cookidoo account not configured.',
    fr: 'Compte Cookidoo non configuré.',
    de: 'Cookidoo-Konto nicht eingerichtet.',
    es: 'Cuenta Cookidoo sin configurar.',
  },
  itemGone: {
    en: 'This item is no longer on the list.',
    fr: "Cet article n'est plus sur la liste.",
    de: 'Dieser Artikel steht nicht mehr auf der Liste.',
    es: 'Este artículo ya no está en la lista.',
  },
  nameMissing: {
    en: 'Give the name of an item.',
    fr: "Indiquez le nom d'un article.",
    de: 'Gib den Namen eines Artikels an.',
    es: 'Indique el nombre de un artículo.',
  },
  formNotSupported: {
    en: 'This button needs Gladys 5.2.0 or later.',
    fr: 'Ce bouton demande Gladys 5.2.0 ou plus récent.',
    de: 'Diese Schaltfläche braucht Gladys 5.2.0 oder neuer.',
    es: 'Este botón requiere Gladys 5.2.0 o posterior.',
  },
};

/** Texts built from a value. Each one returns the four languages. */
export const MESSAGES = {
  added: (name) => ({
    en: `"${name}" added to the shopping list.`,
    fr: `« ${name} » ajouté à la liste de courses.`,
    de: `„${name}“ zur Einkaufsliste hinzugefügt.`,
    es: `«${name}» añadido a la lista de la compra.`,
  }),
  alreadyListed: (name) => ({
    en: `"${name}" is already on the list.`,
    fr: `« ${name} » est déjà sur la liste.`,
    de: `„${name}“ steht schon auf der Liste.`,
    es: `«${name}» ya está en la lista.`,
  }),
  checkedItem: (name) => ({
    en: `"${name}" checked.`,
    fr: `« ${name} » coché.`,
    de: `„${name}“ abgehakt.`,
    es: `«${name}» marcado.`,
  }),
  uncheckedItem: (name) => ({
    en: `"${name}" back on the list.`,
    fr: `« ${name} » remis sur la liste.`,
    de: `„${name}“ wieder auf der Liste.`,
    es: `«${name}» vuelve a la lista.`,
  }),
  notFound: (name) => ({
    en: `No item "${name}" on the list.`,
    fr: `Aucun article « ${name} » sur la liste.`,
    de: `Kein Artikel „${name}“ auf der Liste.`,
    es: `Ningún artículo «${name}» en la lista.`,
  }),
  cleared: (count) => ({
    en: `${count} checked item(s) removed from the list.`,
    fr: `${count} article(s) coché(s) retiré(s) de la liste.`,
    de: `${count} abgehakte(r) Artikel von der Liste entfernt.`,
    es: `${count} artículo(s) marcado(s) quitado(s) de la lista.`,
  }),
  minutes: (minutes) => ({
    en: `${minutes} min`,
    fr: `${minutes} min`,
    de: `${minutes} Min.`,
    es: `${minutes} min`,
  }),
  more: (count) => ({
    en: `${count} more item(s) in Cookidoo.`,
    fr: `${count} autre(s) article(s) dans Cookidoo.`,
    de: `${count} weitere(r) Artikel in Cookidoo.`,
    es: `${count} artículo(s) más en Cookidoo.`,
  }),
  // The Configuration screen action: one sentence per fact.
  connected: ({ toBuy, checked, today, subscription }) => ({
    en: `Connected to Cookidoo. Shopping list: ${toBuy} to buy, ${checked} checked. Today: ${today.en}. Subscription: ${subscription.en}.`,
    fr: `Connecté à Cookidoo. Liste de courses : ${toBuy} à acheter, ${checked} coché(s). Aujourd'hui : ${today.fr}. Abonnement : ${subscription.fr}.`,
    de: `Mit Cookidoo verbunden. Einkaufsliste: ${toBuy} zu kaufen, ${checked} abgehakt. Heute: ${today.de}. Abo: ${subscription.de}.`,
    es: `Conectado a Cookidoo. Lista de la compra: ${toBuy} por comprar, ${checked} marcado(s). Hoy: ${today.es}. Suscripción: ${subscription.es}.`,
  }),
};

/**
 * Pick one language of a multi-language object.
 * @param {Record<string, string>} text
 * @param {string} lang
 */
export function pick(text, lang) {
  return text[lang] ?? text.en;
}

/**
 * A message to THROW: the core shows a thrown message as a plain string, so
 * the four languages are joined.
 * @param {Record<string, string>} text
 * @returns {string}
 */
export function thrown(text) {
  return LANGS.map((lang) => text[lang]).join(' / ');
}

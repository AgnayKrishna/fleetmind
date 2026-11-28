// Driver page strings in Latvian, Russian and English (design: language switch LV / RU / EN).
export type Lang = 'lv' | 'ru' | 'en'
export const LANGS: Lang[] = ['lv', 'ru', 'en']

const EN = {
  today: 'Today', drivingLeft: 'driving left', breakDueIn: 'Break due in', breakNow: 'Take your break now',
  onBreak: 'On a break', now: 'Now', noJob: 'No job right now', noJobBody: 'Dispatch will send you one. Stay where you are.',
  arriveBy: 'Arrive by', then: 'then', navigate: 'Navigate', arrived: "I've arrived", loaded: 'Loaded, leave now',
  handOver: 'Hand over the load', later: 'Later today', backToDepot: 'Back to depot', deliverTo: 'Deliver to',
  pickUpAt: 'Pick up at', photosSignature: 'Photos and signature needed', fuelStop: 'Fuel or charge stop planned',
  report: 'Report a problem', reported: 'Problem reported, help is on the way', startBreak: 'Start break',
  whatsWrong: "What's wrong? (optional)", send: 'Send', cancel: 'Cancel', fromDispatch: 'From dispatch',
  photos: '1. Photos of the load', addPhoto: 'Add photo', receiver: '2. Who received it', receiverPh: 'Name of the receiver',
  signature: '3. Signature', signHere: 'Sign here', clear: 'Clear', damaged: 'Something is damaged or missing',
  damagedPh: 'What is damaged or missing?', delivered: 'Delivered', worksOffline: 'Works offline. Sends when you have signal.',
  back: 'Back', needSign: 'Add the receiver’s name and signature first.', sent: 'Sent. Dispatch has been told.',
  savedOffline: 'Saved on the phone. It sends when you have signal.', waiting: 'waiting to send', urgent: 'Urgent',
  hazmat: 'Dangerous goods (ADR)', kmLeft: 'km left', late: 'min late', onTime: 'on time', fuel: 'Fuel', battery: 'Battery',
  notDriver: 'This page is for drivers. Open the dashboard instead.', openDashboard: 'Open the dashboard', signOut: 'Sign out',
  offline: 'No signal. Showing the last known job.', loading: 'Loading your day…', hoursUnit: 'h', minUnit: 'min',
}
type Strings = typeof EN

const LV: Strings = {
  today: 'Šodien', drivingLeft: 'braukšanas atlicis', breakDueIn: 'Pārtraukums pēc', breakNow: 'Laiks pārtraukumam',
  onBreak: 'Pārtraukumā', now: 'Tagad', noJob: 'Šobrīd nav darba', noJobBody: 'Dispečers drīz atsūtīs jaunu. Paliec, kur esi.',
  arriveBy: 'Ierasties līdz', then: 'pēc tam', navigate: 'Navigācija', arrived: 'Esmu ieradies', loaded: 'Iekrauts, braucu',
  handOver: 'Nodot kravu', later: 'Vēlāk šodien', backToDepot: 'Atpakaļ uz bāzi', deliverTo: 'Piegādāt uz',
  pickUpAt: 'Iekraut', photosSignature: 'Vajag foto un parakstu', fuelStop: 'Plānota uzpilde vai uzlāde',
  report: 'Ziņot par problēmu', reported: 'Problēma paziņota, palīdzība ceļā', startBreak: 'Sākt pārtraukumu',
  whatsWrong: 'Kas noticis? (nav obligāti)', send: 'Sūtīt', cancel: 'Atcelt', fromDispatch: 'No dispečera',
  photos: '1. Kravas foto', addPhoto: 'Pievienot foto', receiver: '2. Kas saņēma', receiverPh: 'Saņēmēja vārds',
  signature: '3. Paraksts', signHere: 'Parakstieties šeit', clear: 'Notīrīt', damaged: 'Kaut kas ir bojāts vai trūkst',
  damagedPh: 'Kas ir bojāts vai trūkst?', delivered: 'Piegādāts', worksOffline: 'Darbojas bez interneta. Nosūtīs, kad būs signāls.',
  back: 'Atpakaļ', needSign: 'Vispirms ieraksti saņēmēja vārdu un parakstu.', sent: 'Nosūtīts. Dispečers zina.',
  savedOffline: 'Saglabāts telefonā. Nosūtīs, kad būs signāls.', waiting: 'gaida nosūtīšanu', urgent: 'Steidzami',
  hazmat: 'Bīstamā krava (ADR)', kmLeft: 'km atlikuši', late: 'min kavējas', onTime: 'laikā', fuel: 'Degviela', battery: 'Akumulators',
  notDriver: 'Šī lapa ir vadītājiem. Atver vadības paneli.', openDashboard: 'Atvērt paneli', signOut: 'Iziet',
  offline: 'Nav signāla. Rāda pēdējo zināmo darbu.', loading: 'Ielādē tavu dienu…', hoursUnit: 'h', minUnit: 'min',
}

const RU: Strings = {
  today: 'Сегодня', drivingLeft: 'вождения осталось', breakDueIn: 'Перерыв через', breakNow: 'Пора сделать перерыв',
  onBreak: 'На перерыве', now: 'Сейчас', noJob: 'Сейчас нет заказа', noJobBody: 'Диспетчер скоро пришлёт новый. Оставайтесь на месте.',
  arriveBy: 'Прибыть до', then: 'затем', navigate: 'Навигация', arrived: 'Я на месте', loaded: 'Загружено, еду',
  handOver: 'Сдать груз', later: 'Позже сегодня', backToDepot: 'Назад на базу', deliverTo: 'Доставить в',
  pickUpAt: 'Забрать в', photosSignature: 'Нужны фото и подпись', fuelStop: 'Запланирована заправка или зарядка',
  report: 'Сообщить о проблеме', reported: 'Проблема отправлена, помощь в пути', startBreak: 'Начать перерыв',
  whatsWrong: 'Что случилось? (необязательно)', send: 'Отправить', cancel: 'Отмена', fromDispatch: 'От диспетчера',
  photos: '1. Фото груза', addPhoto: 'Добавить фото', receiver: '2. Кто принял', receiverPh: 'Имя получателя',
  signature: '3. Подпись', signHere: 'Подпишите здесь', clear: 'Стереть', damaged: 'Что-то повреждено или отсутствует',
  damagedPh: 'Что повреждено или отсутствует?', delivered: 'Доставлено', worksOffline: 'Работает без сети. Отправит, когда появится связь.',
  back: 'Назад', needSign: 'Сначала имя получателя и подпись.', sent: 'Отправлено. Диспетчер в курсе.',
  savedOffline: 'Сохранено в телефоне. Отправится, когда появится связь.', waiting: 'ждут отправки', urgent: 'Срочно',
  hazmat: 'Опасный груз (ADR)', kmLeft: 'км осталось', late: 'мин опоздание', onTime: 'вовремя', fuel: 'Топливо', battery: 'Батарея',
  notDriver: 'Эта страница для водителей. Откройте панель управления.', openDashboard: 'Открыть панель', signOut: 'Выйти',
  offline: 'Нет связи. Показан последний известный заказ.', loading: 'Загружаем ваш день…', hoursUnit: 'ч', minUnit: 'мин',
}

export const STRINGS: Record<Lang, Strings> = { en: EN, lv: LV, ru: RU }
export const LOCALE: Record<Lang, string> = { en: 'en-GB', lv: 'lv-LV', ru: 'ru-RU' }

export function savedLang(): Lang {
  try {
    const l = localStorage.getItem('fmLang')
    if (l === 'lv' || l === 'ru' || l === 'en') return l
  } catch { /* storage blocked */ }
  const nav = (navigator.language || '').slice(0, 2)
  return nav === 'lv' || nav === 'ru' ? nav : 'en'
}

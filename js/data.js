export const TIME_SLOTS = [
    { slot: 1, start: "08:30", end: "10:05", startMin: 510, endMin: 605 },
    { slot: 2, start: "10:25", end: "12:00", startMin: 625, endMin: 720 },
    { slot: 3, start: "12:20", end: "13:55", startMin: 740, endMin: 835 },
    { slot: 4, start: "14:15", end: "15:50", startMin: 855, endMin: 950 },
    { slot: 5, start: "16:10", end: "17:45", startMin: 970, endMin: 1065 },
    { slot: 6, start: "18:05", end: "19:40", startMin: 1085, endMin: 1180 }
];

export const LESSON_TYPES = {
    1: { name: "Лекція", cssClass: "type-lecture" },
    2: { name: "Практика", cssClass: "type-practice" },
    3: { name: "Лабораторна", cssClass: "type-lab" },
    4: { name: "Заняття", cssClass: "type-other" }
};

export const DAYS = [
    { key: "Пн", code: "mon", num: 1 },
    { key: "Вв", code: "tue", num: 2 },
    { key: "Ср", code: "wed", num: 3 },
    { key: "Чт", code: "thu", num: 4 },
    { key: "Пт", code: "fri", num: 5 },
    { key: "Сб", code: "sat", num: 6 }
];

// Онлайн-ссылки из data.js (сопоставление по предмету и/или преподавателю)
export const ONLINE_LINKS = [
    {
        title: "Архітектура комп'ютерних систем",
        lecturer: "Гальчинський",
        link: "https://us04web.zoom.us/j/77391435532?pwd=WeYGlLDQ0yaPGBN06ipYVxJs6OuTS1.1"
    },
    {
        title: "Функціональні залежності та системи",
        lecturer: "Шумська",
        link: "https://us02web.zoom.us/j/2923228017?pwd=WSs4ZC8rbUE4Y0UvMTJOOVMvMlk5UT09"
    },
    {
        title: "Основи технологій захисту інформації",
        lecturer: "Демчінський",
        link: "https://us05web.zoom.us/j/96108926162?pwd=YnkrQWRuOHR0MnhuUVo5dEVsSVo2UT09"
    },
    {
        title: "Бази даних та інформаційні системи",
        lecturer: "Коломицев",
        link: "https://us02web.zoom.us/j/78796314863?pwd=Tll2SFBxaWFUc3JiM1d4VjNpZStTQT09"
    },
    {
        title: "Бази даних та інформаційні системи",
        lecturer: "Личик",
        link: "https://us05web.zoom.us/j/4177321997?pwd=QXQ5VWhzdU1CM01nZ3BWSVh6d0ZQUT09"
    },
    {
        title: "Логіка",
        lecturer: "Потіщук",
        link: "https://us04web.zoom.us/j/2592042684?pwd=WVkraTNYc0tHQW1YTVdndGpHeFhtZz09"
    },
    {
        title: "Логіка",
        lecturer: "Сторожик",
        link: "https://us05web.zoom.us/j/3661121570?pwd=fZv9Li8owRBkXpLAwJLNkedbd9eNa9.1"
    },
    {
        title: "Logic",
        lecturer: "Казаков",
        link: "https://us04web.zoom.us/j/2592042684?pwd=WVkraTNYc0tHQW1YTVdndGpHeFhtZz09"
    },
    {
        title: "Німецька мова (рівень В1)",
        lecturer: "Башук",
        link: "https://us04web.zoom.us/j/4210681284?pwd=aGVLdmtyZ0hUWTBTUmlvbkhzbGRnQT09"
    },
    {
        title: "Твої гроші: фінансові рішення у повсякденному житті",
        lecturer: "Голюк",
        link: "https://us04web.zoom.us/j/9762729233?pwd=eDhGQW9SVktGb0kvODFmaVNlYXNrQT09"
    },
    {
        title: "Цифровий бізнес",
        lecturer: "Цеслів",
        link: "https://us04web.zoom.us/j/77245865586?pwd=PwCSmp118hRHxfA8q1M4RpJbdjQr1s.1"
    },
    {
        title: "Управління командою: результат та ефективність",
        lecturer: "Хлебинська",
        link: "https://moodle.example.com/team"
    },
    {
        title: "Вступ до аналізу шкідливого програмного забезпечення",
        lecturer: "Ільїн",
        link: "https://bbb.kpi.ua/b/myk-gft-nlr-gx2"
    },
    {
        title: "Вступ до аналізу шкідливого програмного забезпечення",
        lecturer: "Войцеховський",
        link: "https://bbb.kpi.ua/b/uwq-ofo-gce-lhw"
    },
    {
        title: "Функціональні залежності та системи",
        lecturer: "Крюков",
        link: "https://us05web.zoom.us/j/2612862666?pwd=YikoxTv2OWTacEmQ30mp4LusrriEtL.1"
    },
    {
        title: "Англійська мова професійного спрямування",
        lecturer: "Гавриленко",
        link: "http://meet.google.com/aoy-hbrn-tdn"
    },
    {
        title: "Моделі рефлексії у кібербезпеці",
        lecturer: "Рибак",
        link: ""
    },
    {
        title: "Моделі рефлексії у кібербезпеці",
        lecturer: "Смирнов",
        link: ""
    },
];
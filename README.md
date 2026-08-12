# stairs2line archive

Готовая реализация миграции старой Razor/JavaScript-страницы в статически генерируемый архив, пригодный одновременно для GitHub Pages и ASP.NET.

## Что реализовано

- Статический HTML содержит все карточки и реальные `<img src>`/`<video>` без необходимости выполнять JavaScript.
- Фильтры artwork представлены отдельными URL:
  - `/{lang}/artworks/` — `top`, с группировкой по artwork;
  - `/{lang}/artworks/major/` — `top + major`, с группировкой;
  - `/{lang}/artworks/versions/` — `top + major + sketchy`, отдельные версии;
  - `/{lang}/artworks/all/` — все версии, включая `decorative`.
- Для каждого списка создаются страницы `/page/N/` и вариант `/oldest/`.
- Кнопка «Лента» является progressive enhancement: она последовательно загружает уже существующие статические страницы. Без JavaScript остаётся обычная пагинация.
- Создаются:
  - общий индекс постов по датам;
  - обратная сортировка;
  - индекс площадок;
  - отдельные ленты каждой площадки;
  - страницы каждого поста;
  - страницы каждого artwork.
- Поддерживаются `ru`, `en`, `ja`, `hreflang`, языковые fallback и дедуплицированные предупреждения о переводах на уровне сущности.
- У artwork поддерживаются локализованные `title` и `description`.
- У каждого поста хранится собственный `status: "alive" | "deleted"`.
- Пост без даты компилируется как `deleted`; для записи из `alive` создаётся предупреждение.
- У постов нет `kind` и расширенного status enum.
- Логический `media` объединяет несколько физических файлов одной версии. Версия artwork и пост ссылаются на один media ID.
- Если часть известных копий отсутствует, но существует хотя бы одна эквивалентная копия, сборка продолжается с предупреждением. Media item без единого существующего файла и production-пост без media являются ошибками.
- Для отображения автоматически выбирается **самый лёгкий существующий файл** внутри media item.
- Имена файлов не меняются.
- Старые media ID разрешаются по прежним правилам только во время сборки или команды `resolve`, а не в браузере.
- Существующий класс `MediaViewer` не изменяется. Добавлен универсальный provider и footer adapter, работающий по `mediaId`, `contextType`, `contextId`.
- Есть статическая административная страница для просмотра ошибок, создания JSON постов/artwork, просмотра media-связей и извлечения дат Twitter.
- Есть ASP.NET-валидатор, который один раз сканирует каталог и сравнивает его с manifest; сгенерированные страницы показывают alert через endpoint, если он доступен.
- Генерируются sitemap, image sitemap и robots.txt, когда задан `site.origin`.
- Есть GitHub Actions workflow для GitHub Pages.

## Результат миграции текущего файла

В `data/source` уже перенесены:

- 243 поста;
- 239 artwork;
- 401 версия;
- 401 логический media item;
- 505 старых media ID;
- 189 связей post → media, которые удалось определить без физического каталога файлов.

Исходный файл не содержал фактический список имён, расширений и размеров — он получал его через `Directory.GetFiles` во время выполнения. Поэтому мигрированные media items пока содержат `legacyIds`. Команда `resolve`, запущенная в настоящем репозитории с каталогом `wwwroot/media/stairs2line`, заполнит точные `files`, добавит найденные связи постов и создаст отчёт.

## Формат данных

Artwork:

```jsonc
{
  "id": "goron",
  "title": {
    "ja": "ごろん",
    "ru": "Горон"
  },
  "description": {
    "ja": "寝続ける",
    "ru": "Несколько связанных вариантов композиции."
  },
  "versions": [
    {
      "id": "2013",
      "scope": "top",
      "knownNotAfter": "2013-09-09",
      "media": [
        {
          "id": "goron/2013/m01",
          "files": [
            "tumblr/example-small.png",
            "pixiv/example-large.png"
          ]
        }
      ]
    }
  ]
}
```

Post:

```jsonc
{
  "key": "twitter:2012457846886334907",
  "platform": "twitter",
  "id": "2012457846886334907",
  "status": "alive",
  "publishedAt": "2026-01-17T12:24:33.000Z",
  "originalLanguage": "ja",
  "description": {
    "ja": "ごろん",
    "ru": "Горон"
  },
  "media": [
    "goron/2026/m01"
  ]
}
```

Media item считается валидным, когда существует хотя бы один файл из `files` или хотя бы один файл, найденный по `legacyIds`. `displayFile` в compiled manifest выбирается по минимальному `byteLength`.

## Команды

### Повторить миграцию старого файла

```bash
node src/cli.mjs migrate \
  --input "/path/to/legacy-page.cshtml.txt" \
  --output data/source
```

### Разрешить старые ID в точные пути

```bash
node src/cli.mjs resolve \
  --source data/source \
  --media-root /path/to/wwwroot/media/stairs2line \
  --output data/resolved
```

Команда сохраняет исходное разбиение по файлам, заполняет `media[].files`, добавляет явно найденные post → media связи и создаёт `resolve-report.json`.

### Проверить данные

```bash
node src/cli.mjs validate \
  --source data/resolved \
  --media-root /path/to/wwwroot/media/stairs2line \
  --output validation.json
```

При ошибках команда возвращает ненулевой exit code.

### Собрать GitHub Pages

```bash
node src/cli.mjs build \
  --source data/resolved \
  --media-root /path/to/wwwroot/media/stairs2line \
  --output dist \
  --base-path /repository-name/ \
  --site-origin https://owner.github.io \
  --copy-media
```

Для собственного домена используется `--base-path /`.

### Собрать дизайн-превью без каталога файлов

```bash
node src/cli.mjs build \
  --source data/source \
  --output dist-preview \
  --base-path /stairs2line-preview/ \
  --preview-placeholders
```

В этом режиме для неразрешённых media создаются SVG placeholders. Он предназначен только для проверки HTML и дизайна.

## Предупреждения о языках

Проверка выполняется один раз на сущность до генерации страниц. Ключ дедупликации:

```text
severity + code + entityType + entityId
```

Поэтому один artwork не создаёт повторные предупреждения для индекса, страницы artwork, страниц годов и языковых версий. Один объект warning объединяет все отсутствующие поля и языки:

```json
{
  "code": "i18n.missing",
  "entityType": "artwork",
  "entityId": "goron",
  "missing": {
    "title": ["en"],
    "description": ["en", "ru"]
  }
}
```

`"default"` в локализованном объекте означает, что значение намеренно одинаково для всех языков и warning не нужен.

## MediaViewer

`src/site/media-viewer-adapter.js` использует существующий глобальный `MediaViewer` без изменений. Он:

- находит все `[data-viewer-media]` в текущем DOM;
- учитывает карточки, добавленные режимом ленты;
- при достижении конца уже загруженной ленты подгружает следующую статическую страницу через callback provider;
- передаёт существующему viewer предыдущий/следующий элемент;
- загружает `data/viewer-index.json`;
- показывает данные текущего поста либо artwork version и все связанные публикации.

Если `MediaViewer`, jQuery или `#mediaModal` отсутствуют, обычные ссылки на файлы продолжают работать.

## ASP.NET

Файлы в `src/aspnet` добавляют:

- singleton-валидатор каталога;
- `/api/stairs2line/archive-validation`;
- Razor partial с Bootstrap alert;
- пример регистрации в `Program.cs`.

Валидатор использует compiled `wwwroot/data/manifest.json`, кеширует результат и не сканирует файловую систему на каждом запросе.

## Тесты

```bash
npm test
```

Проверяются:

- полный импорт текущих данных;
- старые правила извлечения media ID из имён;
- выбор самого лёгкого файла;
- допустимость отсутствующей копии при наличии эквивалентной;
- дедупликация i18n warnings;
- преобразование alive без даты в deleted;
- наличие реальных media URL непосредственно в статическом HTML.

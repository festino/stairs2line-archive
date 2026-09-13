export const DEFAULT_SITE = {
  schemaVersion: 2,
  id: 'stairs2line',
  basePath: '/',
  mediaBasePath: 'media/stairs2line/',
  imagePreview: 'tumblr/143559403624_tumblr_o6dg5xA0UN1s4v84ho1_400.png',
  defaultLanguage: 'en',
  languages: ['ru', 'en', 'ja'],
  mediaDirectories: ['twitter', 'tumblr', 'pixiv', 'other'],
  pageSize: {
    artworks: 36,
    versions: 48,
    posts: 20
  },
  title: {
    ru: 'Архив stairs2line',
    en: 'stairs2line archive',
    ja: 'stairs2line アーカイブ'
  },
  description: {
    ru: 'Все найденные версии рисунков, анимаций и публикаций stairs2line.',
    en: 'An archive of discovered stairs2line artwork versions, animations, and posts.',
    ja: 'stairs2line の見つかった作品バージョン、アニメーション、投稿のアーカイブ。'
  }
};

export const DEFAULT_PLATFORMS = {
  platforms: [
    {
      id: 'twitter',
      label: { default: 'Twitter / X' },
      defaultAccount: 'stairs2line',
      postUrlTemplate: 'https://twitter.com/{account}/status/{id}',
      icon: 'misc/twitter-icon-free-png.webp',
      versions: [{ account: 'stairs2line', sourceUrl: 'https://twitter.com/stairs2line' }]
    },
    {
      id: 'pixiv',
      label: { default: 'pixiv' },
      defaultAccount: '1593221',
      postUrlTemplate: 'https://www.pixiv.net/en/artworks/{id}',
      icon: 'misc/pixiv_favicon20250122.ico',
      versions: [{ account: '1593221', sourceUrl: 'https://www.pixiv.net/users/1593221', banner: null }]
    },
    {
      id: 'tumblr',
      label: { default: 'Tumblr' },
      defaultAccount: 'michinoku800',
      postUrlTemplate: 'https://michinoku800.tumblr.com/post/{id}',
      icon: 'misc/tumblr_favicon.ico',
      versions: [{ account: 'michinoku800', sourceUrl: 'https://michinoku800.tumblr.com/' }]
    },
    {
      id: 'instagram',
      label: { default: 'Instagram' },
      defaultAccount: 'stairs2line',
      postUrlTemplate: 'https://www.instagram.com/p/{id}/',
      icon: 'misc/instagram_favicon.png',
      versions: [{ account: 'stairs2line', sourceUrl: 'https://www.instagram.com/stairs2line/' }]
    },
    {
      id: 'piapro',
      label: { default: 'Piapro Blog' },
      icon: 'misc/blog-piapro_favicon.ico',
      versions: [{ sourceUrl: 'https://blog.piapro.net/' }]
    },
    {
      id: 'snowmiku.com',
      label: { default: 'Snow Miku' },
      icon: 'misc/snowmiku_favicon.ico',
      versions: [{ sourceUrl: 'https://snowmiku.com/' }]
    },
    {
      id: 'pixivFANBOX',
      label: { default: 'pixivFANBOX' },
      icon: 'misc/Pixiv_FANBOX_(Icon).svg',
      versions: [{ sourceUrl: 'https://www.pixiv.net/fanbox/user/1593221' }]
    }
  ]
};

export const DEFAULT_LOCALES = {
  ru: {
    nav: {
      artworks: 'Работы',
      posts: 'Посты',
      platforms: 'Площадки',
      admin: 'Редактор',
      home: 'Главная',
      gallery: 'Галерея',
      socials: 'Соцсети',
      revisions: 'Ревизии'
    },
    home: {
      sectionsTitle: 'Разделы архива',
      projectDescription: 'Визуальный архив stairs2line: работы и их ревизии, публикации в соцсетях и связанная с ними хронология.',
      artistDescription: 'Японский художник, во многом известный иллюстрациями с Хацунэ Мику.',
      archivePurpose: 'Цель этого архива — собрать все работы и все известные версии работ, раскиданные по интернету, в одном месте. Я никак не связан с автором и пока не получил разрешение на публикацию этого архива.',
      supportText: 'Рекомендую поддержать автора на официальных активных аккаунтах: {accounts}.',
      officialAccounts: '{accounts}',
      allAccounts: 'Все аккаунты',
      featuredTitle: 'Избранные работы',
      contact: 'Почта для связи',
      galleryDescription: 'Просто посмотреть картинки.',
      socialsDescription: 'Архив постов на разных площадках.',
      revisionsDescription: 'Поразглядывать, как работы менялись между годами.'
    },
    gallery: {
      pageTitle: 'Галерея',
      description: 'Плотная галерея изображений stairs2line с фильтрацией по scope.'
    },
    common: {
      newest: 'Сначала новые',
      oldest: 'Сначала старые',
      feed: 'Лента',
      pages: 'Страницы',
      previous: 'Предыдущая',
      next: 'Следующая',
      page: 'Страница {page}',
      unknownDate: 'Дата неизвестна',
      deleted: 'Удалён',
      alive: 'Доступен',
      lost: 'Утерян',
      source: 'Источник',
      posts: 'Публикации',
      versions: 'Версии',
      files: 'Файлы',
      open: 'Открыть',
      noItems: 'Нет элементов.'
    },
    artworks: {
      popular: 'Популярные',
      major: 'Основные',
      versions: 'Все версии',
      all: 'Все найденные',
      pageTitle: 'Работы stairs2line',
      created: 'Создано {date}',
      knownNotAfter: 'Не позднее {date}',
      firstPost: 'Первая известная публикация: {date}',
      noKnownPosts: 'Известных публикаций с этим изображением нет.',
      artworkVersions: 'Версии работы',
      genericDescription: 'Artwork stairs2line: {versions} версий, {media} медиафайлов.',
      revisionsTitle: 'Ревизии работ',
      revisionsDescription: 'Недекоративные версии работ: несколько версий совмещаются для сравнения без внутреннего кропа; одиночные известные версии собраны отдельно в конце.',
      singleImagesTitle: 'Одиночные известные версии',
      longestInterval: 'Сначала длинные интервалы',
      shortestInterval: 'Сначала короткие интервалы',
      unconfirmedTitle: 'Работы для подтверждения',
      unconfirmedDescription: 'Работы, ни одна известная версия которых не встречается ни в одной архивной публикации.'
    },
    posts: {
      pageTitle: 'Посты stairs2line',
      all: 'Все посты',
      activity: 'Активность',
      activityDescription: 'Активность публикаций по архивным площадкам, сгруппированная по месяцам.',
      publicationCount: 'Публикаций: {count}',
      lessActivity: 'Меньше',
      moreActivity: 'Больше',
      grouped: 'По площадкам',
      view: 'Вид постов',
      fullView: 'Полный вид',
      compactView: 'Компактный вид',
      versionLabel: 'Версия {current} из {total}',
      platformTitle: 'Посты на {platform}',
      genericDescription: 'Архивная публикация stairs2line на {platform}.',
      approximateDate: '≈ {date}',
      lostTitle: 'Утерянный пост на {platform}',
      lostMediaOnly: 'Сам пост не сохранился; остались только изображения. Дата приблизительная и восстановлена по идентификатору медиа Twitter.',
      originalPost: 'Открыть оригинал поста',
      officialPage: 'Официальная страница',
      firstRebloggedAt: 'Самый ранний известный репост:',
      savedReblogs: 'Сохранившиеся репосты:',
      noKnownReblogDate: 'дата неизвестна',
      noSavedReblogs: 'нет',
      socialsTitle: 'Соцсети',
      platformCreated: 'Создан профиль {platform}'
    },
    validation: {
      title: 'Проверка архива',
      errors: 'Ошибок: {count}',
      warnings: 'Предупреждений: {count}'
    }
  },
  en: {
    nav: {
      artworks: 'Artworks',
      posts: 'Posts',
      platforms: 'Platforms',
      admin: 'Editor',
      home: 'Home',
      gallery: 'Gallery',
      socials: 'Socials',
      revisions: 'Revisions'
    },
    home: {
      sectionsTitle: 'Archive sections',
      projectDescription: 'A visual archive of stairs2line: artworks and their revisions, posts across social platforms, and the chronology connecting them.',
      artistDescription: 'A Japanese artist, best known for illustrations featuring Hatsune Miku.',
      archivePurpose: 'The goal of this archive is to collect all works and all known versions scattered across the internet in one place. I am not affiliated with the artist and have not yet received permission to publish this archive.',
      supportText: 'Please support the artist through the official active accounts: {accounts}.',
      officialAccounts: '{accounts}',
      allAccounts: 'All accounts',
      featuredTitle: 'Selected works',
      contact: 'Contact',
      galleryDescription: 'Just browse the pictures.',
      socialsDescription: 'An archive of posts across different platforms.',
      revisionsDescription: 'See how the artworks changed over the years.'
    },
    gallery: {
      pageTitle: 'Gallery',
      description: 'A dense gallery of stairs2line images, filterable by archive scope.'
    },
    common: {
      newest: 'Newest first',
      oldest: 'Oldest first',
      feed: 'Feed',
      pages: 'Pages',
      previous: 'Previous',
      next: 'Next',
      page: 'Page {page}',
      unknownDate: 'Unknown date',
      deleted: 'Deleted',
      alive: 'Available',
      lost: 'Lost',
      source: 'Source',
      posts: 'Posts',
      versions: 'Versions',
      files: 'Files',
      open: 'Open',
      noItems: 'No items.'
    },
    artworks: {
      popular: 'Popular',
      major: 'Major',
      versions: 'All versions',
      all: 'All found',
      pageTitle: 'stairs2line artworks',
      created: 'Created {date}',
      knownNotAfter: 'By {date}',
      firstPost: 'First known post: {date}',
      noKnownPosts: 'No known posts use this image.',
      artworkVersions: 'Artwork versions',
      genericDescription: 'A stairs2line artwork with {versions} versions and {media} media items.',
      revisionsTitle: 'Artwork revisions',
      revisionsDescription: 'Non-decorative artwork versions: multi-version groups are aligned for comparison without cropping; single known versions are collected separately at the end.',
      singleImagesTitle: 'Single known versions',
      longestInterval: 'Longest interval first',
      shortestInterval: 'Shortest interval first',
      unconfirmedTitle: 'Works to confirm',
      unconfirmedDescription: 'Artworks for which no known version appears in any archived post.'
    },
    posts: {
      pageTitle: 'stairs2line posts',
      all: 'All posts',
      activity: 'Activity',
      activityDescription: 'Posting activity across archived platforms, grouped by month.',
      publicationCount: 'Posts: {count}',
      lessActivity: 'Less',
      moreActivity: 'More',
      grouped: 'By platform',
      view: 'Post view',
      fullView: 'Full view',
      compactView: 'Compact view',
      versionLabel: 'Version {current} of {total}',
      platformTitle: 'Posts on {platform}',
      genericDescription: 'An archived stairs2line post on {platform}.',
      approximateDate: '≈ {date}',
      lostTitle: 'Lost post on {platform}',
      lostMediaOnly: 'The post itself was not preserved; only its images remain. The date is approximate and inferred from the Twitter media identifier.',
      originalPost: 'Open original post',
      officialPage: 'Official page',
      firstRebloggedAt: 'Earliest known reblog:',
      savedReblogs: 'Preserved reblogs:',
      noKnownReblogDate: 'date unknown',
      noSavedReblogs: 'none',
      socialsTitle: 'Socials',
      platformCreated: '{platform} profile created'
    },
    validation: {
      title: 'Archive validation',
      errors: 'Errors: {count}',
      warnings: 'Warnings: {count}'
    }
  },
  ja: {
    nav: {
      artworks: '作品',
      posts: '投稿',
      platforms: 'プラットフォーム',
      admin: '編集',
      home: 'ホーム',
      gallery: 'ギャラリー',
      socials: 'SNS',
      revisions: '改訂履歴'
    },
    home: {
      sectionsTitle: 'アーカイブ',
      projectDescription: 'stairs2line の作品、改訂版、SNS 投稿、それらをつなぐ時系列をまとめたビジュアルアーカイブです。',
      artistDescription: '初音ミクのイラストなどで知られる日本のイラストレーターです。',
      archivePurpose: 'このアーカイブは、インターネット上に散らばった作品と既知の全バージョンを一か所に集めることを目的としています。私は作者本人とは関係がなく、このアーカイブの公開許可もまだ得ていません。',
      supportText: '作者を応援する際は、現在利用されている公式アカウントをご覧ください: {accounts}。',
      officialAccounts: '{accounts}',
      allAccounts: 'すべてのアカウント',
      featuredTitle: 'ピックアップ',
      contact: '連絡先',
      galleryDescription: '画像を気軽に眺めるためのギャラリーです。',
      socialsDescription: 'さまざまなプラットフォームの投稿アーカイブです。',
      revisionsDescription: '作品が年月とともにどう変わっていったかを見比べられます。'
    },
    gallery: {
      pageTitle: 'ギャラリー',
      description: 'scope で絞り込める stairs2line の画像ギャラリーです。'
    },
    common: {
      newest: '新しい順',
      oldest: '古い順',
      feed: 'フィード',
      pages: 'ページ',
      previous: '前へ',
      next: '次へ',
      page: '{page}ページ',
      unknownDate: '日付不明',
      deleted: '削除済み',
      alive: '公開中',
      lost: '消失',
      source: '出典',
      posts: '投稿',
      versions: 'バージョン',
      files: 'ファイル',
      open: '開く',
      noItems: '項目がありません。'
    },
    artworks: {
      popular: '人気',
      major: '主要',
      versions: '全バージョン',
      all: '発見済みすべて',
      pageTitle: 'stairs2line 作品',
      created: '{date}に制作',
      knownNotAfter: '{date}まで',
      firstPost: '最初に確認された投稿: {date}',
      noKnownPosts: 'この画像を含む既知の投稿はありません。',
      artworkVersions: '作品バージョン',
      genericDescription: 'stairs2line の作品。{versions}バージョン、{media}メディア。',
      revisionsTitle: '作品の改訂履歴',
      revisionsDescription: '装飾用を除いた既知のバージョンを表示します。複数版は画像内部を切り抜かずに位置を合わせて比較し、単独版は末尾に分けて表示します。',
      singleImagesTitle: '単独の既知バージョン',
      longestInterval: '期間が長い順',
      shortestInterval: '期間が短い順',
      unconfirmedTitle: '確認したい作品',
      unconfirmedDescription: '既知のどのバージョンも、保存されている投稿には見つかっていない作品です。'
    },
    posts: {
      pageTitle: 'stairs2line 投稿',
      all: 'すべての投稿',
      activity: 'アクティビティ',
      activityDescription: '保存された各プラットフォームの投稿活動を月ごとにまとめたものです。',
      publicationCount: '投稿: {count}',
      lessActivity: '少ない',
      moreActivity: '多い',
      grouped: 'プラットフォーム別',
      view: '投稿表示',
      fullView: '通常表示',
      compactView: 'コンパクト表示',
      versionLabel: 'バージョン {current} / {total}',
      platformTitle: '{platform}の投稿',
      genericDescription: '{platform}にある stairs2line のアーカイブ投稿。',
      approximateDate: '約 {date}',
      lostTitle: '{platform}の消失した投稿',
      lostMediaOnly: '投稿自体は保存されておらず、画像だけが残っています。日付は Twitter のメディア識別子から推定した概算です。',
      originalPost: '元の投稿を開く',
      officialPage: '公式ページ',
      firstRebloggedAt: '最も早く確認されたリブログ:',
      savedReblogs: '保存されているリブログ:',
      noKnownReblogDate: '日付不明',
      noSavedReblogs: 'なし',
      socialsTitle: 'SNS',
      platformCreated: '{platform} のプロフィールを作成'
    },
    validation: {
      title: 'アーカイブ検証',
      errors: 'エラー: {count}',
      warnings: '警告: {count}'
    }
  }
};

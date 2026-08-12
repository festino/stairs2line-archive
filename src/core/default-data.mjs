export const DEFAULT_SITE = {
  schemaVersion: 1,
  id: 'stairs2line',
  basePath: '/',
  mediaBasePath: 'media/stairs2line/',
  imagePreview: 'tumblr/143559403624_tumblr_o6dg5xA0UN1s4v84ho1_400.png',
  defaultLanguage: 'ru',
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
      icon: 'misc/twitter-icon-free-png.webp'
    },
    {
      id: 'pixiv',
      label: { default: 'pixiv' },
      defaultAccount: '1593221',
      postUrlTemplate: 'https://www.pixiv.net/en/artworks/{id}',
      icon: 'misc/pixiv_favicon20250122.ico'
    },
    {
      id: 'tumblr',
      label: { default: 'Tumblr' },
      defaultAccount: 'michinoku800',
      postUrlTemplate: 'https://michinoku800.tumblr.com/post/{id}',
      icon: 'misc/tumblr_favicon.ico'
    },
    {
      id: 'instagram',
      label: { default: 'Instagram' },
      defaultAccount: 'stairs2line',
      postUrlTemplate: 'https://www.instagram.com/p/{id}/',
      icon: 'misc/instagram_favicon.png'
    },
    {
      id: 'piapro',
      label: { default: 'Piapro Blog' },
      icon: 'misc/blog-piapro_favicon.ico'
    },
    {
      id: 'snowmiku.com',
      label: { default: 'Snow Miku' },
      icon: 'misc/snowmiku_favicon.ico'
    },
    {
      id: 'pixivFANBOX',
      label: { default: 'pixivFANBOX' },
      icon: 'misc/Pixiv_FANBOX_(Icon).svg'
    }
  ]
};

export const DEFAULT_LOCALES = {
  ru: {
    nav: {
      artworks: 'Работы',
      posts: 'Посты',
      platforms: 'Площадки',
      admin: 'Редактор'
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
      knownNotAfter: 'Известно не позднее {date}',
      firstPost: 'Первая известная публикация: {date}',
      genericDescription: 'Artwork stairs2line: {versions} версий, {media} медиафайлов.'
    },
    posts: {
      pageTitle: 'Посты stairs2line',
      all: 'Все посты',
      grouped: 'По площадкам',
      platformTitle: 'Посты на {platform}',
      genericDescription: 'Архивная публикация stairs2line на {platform}.'
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
      admin: 'Editor'
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
      knownNotAfter: 'Known no later than {date}',
      firstPost: 'First known post: {date}',
      genericDescription: 'A stairs2line artwork with {versions} versions and {media} media items.'
    },
    posts: {
      pageTitle: 'stairs2line posts',
      all: 'All posts',
      grouped: 'By platform',
      platformTitle: 'Posts on {platform}',
      genericDescription: 'An archived stairs2line post on {platform}.'
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
      admin: '編集'
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
      knownNotAfter: '{date}以前に存在',
      firstPost: '最初に確認された投稿: {date}',
      genericDescription: 'stairs2line の作品。{versions}バージョン、{media}メディア。'
    },
    posts: {
      pageTitle: 'stairs2line 投稿',
      all: 'すべての投稿',
      grouped: 'プラットフォーム別',
      platformTitle: '{platform}の投稿',
      genericDescription: '{platform}にある stairs2line のアーカイブ投稿。'
    },
    validation: {
      title: 'アーカイブ検証',
      errors: 'エラー: {count}',
      warnings: '警告: {count}'
    }
  }
};

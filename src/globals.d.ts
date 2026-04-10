type ReactNode = unknown;

declare const Spicetify: {
  React: {
    useState: <T>(
      initialValue: T
    ) => [T, (value: T | ((currentValue: T) => T)) => void];
    createElement: (
      type: string | ((...args: any[]) => any),
      props?: Record<string, unknown> | null,
      ...children: ReactNode[]
    ) => ReactNode;
  };
  Playbar?: {
    Button: new (
      label: string,
      icon: string,
      onClick: () => void,
      disabled?: boolean,
      active?: boolean,
      registerOnCreate?: boolean
    ) => {
      label: string;
      icon: string;
      disabled: boolean;
      active: boolean;
      element: HTMLButtonElement;
      register: () => void;
      deregister: () => void;
    };
  };
  ContextMenu?: {
    Item: new (
      label: string,
      onClick: (
        uris: string[],
        uids?: string[],
        contextUri?: string
      ) => void | Promise<void>,
      shouldAdd: (
        uris: string[],
        uids?: string[],
        contextUri?: string
      ) => boolean,
      icon?: string
    ) => {
      register: () => void;
      deregister: () => void;
    };
  };
  SVGIcons?: Record<string, string>;
  Player?: {
    data?: {
      context_uri?: string;
      context_metadata?: {
        title?: string;
        name?: string;
      };
      page_metadata?: {
        title?: string;
        name?: string;
      };
      item?: {
        metadata?: {
          title?: string;
          artist_name?: string;
          album_title?: string;
          image_url?: string;
          image_large_url?: string;
        };
      };
    };
    getDuration: () => number;
    getProgress: () => number;
    getProgressPercent: () => number;
    getVolume: () => number;
    setVolume: (volume: number) => void;
    next: () => void | Promise<void>;
    isPlaying: () => boolean;
    addEventListener: (type: string, callback: (event?: unknown) => void) => void;
    removeEventListener: (type: string, callback: (event?: unknown) => void) => void;
  };
  LocalStorage?: {
    get: (key: string) => string | null;
    set: (key: string, value: string) => void;
  };
  Platform?: unknown;
  showNotification: (message: string, isError?: boolean) => void;
};

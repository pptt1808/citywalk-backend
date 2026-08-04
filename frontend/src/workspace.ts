export type WorkspacePage = 'chat' | 'profile' | 'preferences' | 'scrapbook' | 'walk'

export type NavigateWorkspace = (page: WorkspacePage) => void

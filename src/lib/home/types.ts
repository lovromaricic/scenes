/** What a project's card on the home screen shows. */
export interface ProjectSummary {
	id: string;
	title: string;
	/** Seconds. */
	duration: number;
	width: number;
	height: number;
	updatedAt: number;
	/** Object URL of the project's thumbnail, if there is one. */
	thumbnail?: string;
}

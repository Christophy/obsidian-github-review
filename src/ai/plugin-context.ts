import type { GitHubClient } from "../github/client";
import type { ReviewService } from "../core/review-service";
import type { Ref } from "../core/model";

/**
 * Everything a plugin-context tool handler needs to answer Claude. Extend this
 * as more capabilities are exposed (it's the one place tools reach plugin state).
 */
export interface PluginContext {
    client: GitHubClient;
    review: ReviewService;
    /** The issue/PR the tools answer about. */
    ref: Ref;
}

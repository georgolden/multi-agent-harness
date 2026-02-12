import path from 'path';
import { readdir, readFile } from 'fs/promises';
import { glob } from 'glob';
import { parseFrontmatter } from '../utils/frontmatter.js';

export type SkillFile = {
  path: string;
  content: string;
};

export type Skill = {
  location: string;
  name: string;
  description: string;
  readSkillMd: () => Promise<string>;
  readContent: () => Promise<SkillFile[]>;
};

type SkillFrontmatter = {
  name: string;
  description: string;
};

export class Skills {
  private skillsDir: string;
  private skills: Skill[] = [];
  private isStarted: boolean = false;

  constructor(cwd: string = process.cwd()) {
    this.skillsDir = path.join(cwd, 'src/skills');
  }

  /**
   * Reads all files from a skill folder recursively, excluding SKILL.md
   */
  private createReadContentFn(skillLocation: string): () => Promise<SkillFile[]> {
    return async () => {
      // Find all files recursively in the skill folder
      const pattern = path.join(skillLocation, '**', '*');
      const files = await glob(pattern, {
        nodir: true,
        absolute: false,
        cwd: skillLocation,
      });

      // Filter out SKILL.md and read each file
      const fileContents = await Promise.all(
        files
          .filter(file => path.basename(file) !== 'SKILL.md')
          .map(async (file) => {
            const absolutePath = path.join(skillLocation, file);
            const content = await readFile(absolutePath, 'utf-8');
            return {
              path: absolutePath,
              content,
            };
          })
      );

      return fileContents;
    };
  }

  /**
   * Creates a function to read SKILL.md on demand
   */
  private createReadSkillMdFn(skillLocation: string): () => Promise<string> {
    return async () => {
      const skillMdPath = path.join(skillLocation, 'SKILL.md');
      return await readFile(skillMdPath, 'utf-8');
    };
  }

  /**
   * Initializes and loads all skills
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      console.warn('Skills already started');
      return;
    }

    // Read all directories in the skills folder
    const entries = await readdir(this.skillsDir, { withFileTypes: true });
    const skillDirs = entries.filter(entry => entry.isDirectory());

    // Process each skill directory
    const skills = await Promise.all(
      skillDirs.map(async (dir) => {
        const skillLocation = path.join(this.skillsDir, dir.name);
        const skillMdPath = path.join(skillLocation, 'SKILL.md');

        try {
          // Read and parse SKILL.md to extract metadata only
          const skillMdContent = await readFile(skillMdPath, 'utf-8');
          const { frontmatter } = parseFrontmatter<SkillFrontmatter>(skillMdContent);

          // Validate required fields
          if (!frontmatter.name || !frontmatter.description) {
            console.warn(`Skill in ${dir.name} is missing name or description in SKILL.md frontmatter`);
            return null;
          }

          // Create the skill object with lazy loaders
          const skill: Skill = {
            location: skillLocation,
            name: frontmatter.name,
            description: frontmatter.description,
            readSkillMd: this.createReadSkillMdFn(skillLocation),
            readContent: this.createReadContentFn(skillLocation),
          };

          return skill;
        } catch (error) {
          console.warn(`Failed to load skill from ${dir.name}:`, error);
          return null;
        }
      })
    );

    // Filter out failed skills
    this.skills = skills.filter((skill): skill is Skill => skill !== null);
    this.isStarted = true;

    console.log(`Skills started: ${this.skills.length} skills loaded`);
  }

  /**
   * Stops and cleans up resources
   */
  async stop(): Promise<void> {
    if (!this.isStarted) {
      console.warn('Skills not started');
      return;
    }

    this.skills = [];
    this.isStarted = false;

    console.log('Skills stopped');
  }

  /**
   * Gets all loaded skills
   */
  getSkills(): Skill[] {
    if (!this.isStarted) {
      throw new Error('Skills not started. Call start() first.');
    }
    return this.skills;
  }

  /**
   * Gets a skill by name
   */
  getSkill(name: string): Skill | undefined {
    if (!this.isStarted) {
      throw new Error('Skills not started. Call start() first.');
    }
    return this.skills.find(skill => skill.name === name);
  }

  /**
   * Checks if skills are started
   */
  isRunning(): boolean {
    return this.isStarted;
  }
}

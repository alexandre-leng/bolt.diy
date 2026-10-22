import type { UIMessage } from 'ai';
import React, { useState } from 'react';
import { Button } from '~/components/ui/Button';
import { logStore } from '~/lib/stores/logs'; // Assuming logStore is imported from this location
import { toast } from '~/lib/toastify';
import { classNames } from '~/utils/classNames';
import { MAX_FILES, isBinaryFile, shouldIncludeFile } from '~/utils/fileUtils';
import { createChatFromFolder } from '~/utils/folderImport';

interface ImportFolderButtonProps {
  className?: string;
  importChat?: (description: string, messages: UIMessage[]) => Promise<void>;
}

export const ImportFolderButton: React.FC<ImportFolderButtonProps> = ({ className, importChat }) => {
  const [isLoading, setIsLoading] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const allFiles = Array.from(e.target.files || []);

    const filteredFiles = allFiles.filter((file) => {
      const path = file.webkitRelativePath.split('/').slice(1).join('/');
      const include = shouldIncludeFile(path);

      return include;
    });

    if (filteredFiles.length === 0) {
      const error = new Error('Aucun fichier valide trouvé');
      logStore.logError('File import failed - no valid files', error, { folderName: 'Unknown Folder' });
      toast.error('Aucun fichier valide trouvé dans le dossier sélectionné');

      return;
    }

    if (filteredFiles.length > MAX_FILES) {
      const error = new Error(`Too many files: ${filteredFiles.length}`);
      logStore.logError('File import failed - too many files', error, {
        fileCount: filteredFiles.length,
        maxFiles: MAX_FILES,
      });
      toast.error(
        `Ce dossier contient ${filteredFiles.length.toLocaleString()} fichiers. Bolt n’est pas encore optimisé pour les très grands projets. Veuillez choisir un dossier de moins de ${MAX_FILES.toLocaleString()} fichiers.`,
      );

      return;
    }

    const folderName = filteredFiles[0]?.webkitRelativePath.split('/')[0] || 'Unknown Folder';
    setIsLoading(true);

    const loadingToast = toast.loading(`Importation de ${folderName}…`);

    try {
      const fileChecks = await Promise.all(
        filteredFiles.map(async (file) => ({
          file,
          isBinary: await isBinaryFile(file),
        })),
      );

      const textFiles = fileChecks.filter((f) => !f.isBinary).map((f) => f.file);

      const binaryFilePaths = fileChecks
        .filter((f) => f.isBinary)
        .map((f) => f.file.webkitRelativePath.split('/').slice(1).join('/'));

      if (textFiles.length === 0) {
        const error = new Error('Aucun fichier texte trouvé');
        logStore.logError('File import failed - no text files', error, { folderName });
        toast.error('Aucun fichier texte trouvé dans le dossier sélectionné');

        return;
      }

      if (binaryFilePaths.length > 0) {
        logStore.logWarning(`Skipping binary files during import`, {
          folderName,
          binaryCount: binaryFilePaths.length,
        });
        toast.info(
          `${binaryFilePaths.length} fichier${binaryFilePaths.length > 1 ? 's' : ''} binaire${binaryFilePaths.length > 1 ? 's' : ''} ignoré${binaryFilePaths.length > 1 ? 's' : ''}`,
        );
      }

      const messages = await createChatFromFolder(textFiles, binaryFilePaths, folderName);

      if (importChat) {
        await importChat(folderName, [...messages]);
      }

      logStore.logSystem('Folder imported successfully', {
        folderName,
        textFileCount: textFiles.length,
        binaryFileCount: binaryFilePaths.length,
      });
      toast.success('Dossier importé avec succès');
    } catch (error) {
      logStore.logError('Failed to import folder', error, { folderName });
      console.error('Failed to import folder:', error);
      toast.error('Échec de l’importation du dossier');
    } finally {
      setIsLoading(false);
      toast.dismiss(loadingToast);
      e.target.value = ''; // Reset file input
    }
  };

  return (
    <>
      <input
        type="file"
        id="folder-import"
        className="hidden"
        webkitdirectory=""
        directory=""
        onChange={handleFileChange}
        {...({} as any)}
      />
      <Button
        onClick={() => {
          const input = document.getElementById('folder-import');
          input?.click();
        }}
        title="Importer un dossier"
        variant="default"
        size="lg"
        className={classNames(
          'gap-2 bg-bolt-elements-background-depth-1',
          'text-bolt-elements-textPrimary',
          'hover:bg-bolt-elements-background-depth-2',
          'border border-bolt-elements-borderColor',
          'h-10 px-4 py-2 min-w-[120px] justify-center',
          'transition-all duration-200 ease-in-out',
          className,
        )}
        disabled={isLoading}
      >
        <span className="i-ph:upload-simple w-4 h-4" />
        {isLoading ? 'Importation…' : 'Importer un dossier'}
      </Button>
    </>
  );
};

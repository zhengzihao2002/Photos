package photos.utility;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.ObjectInputStream;
import java.io.ObjectOutputStream;
import java.io.Serializable;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Optional;

import javafx.event.EventHandler;
import javafx.scene.control.Alert;
import javafx.scene.control.ButtonType;
import javafx.stage.Stage;
import javafx.stage.WindowEvent;
import photos.controller.LoginController;
import javafx.scene.control.Alert.AlertType;


/**
A class that manages the attributes of photos
@author Zihao Zheng , Yiming Huang.
@since s4/13/23
*/
public class Photo implements Serializable{
	private static final long serialVersionUID = 1L;
	/**
	 * all photo's in the directory
	 */
	public static ArrayList<Photo> allPhotos; 
	
	/**
	 * The path of the photo
	 */
    private String path;
    
    /**
     * The arrarylist of tags associated with the photo
     */
    private ArrayList<String> tags;
    
    /**
     * The caption of the photo
     */
    private String caption;
    
    /**
     * Current directory of the running project
     */
	static String currentDir = System.getProperty("user.dir");
	/**
     * The path to storage directory called "local", where it contains the subdirectories of which each has the name of the specific user
     */
	static String storageDir = currentDir+"/src/photos/local";

	/**
	 * The constructor for Photo object. It initializes the tag array list, sets caption to a empty string, and sets the path to the given path
	 * @param path Path for the photo 
	 */
    public Photo(String path) {
        this.path = path;
        this.tags = new ArrayList<>();
        this.caption = "";
    }

    /**
	 * The method to get the path for the current photo
	 * @return the path in a form of a string
	 */
    public String getPath() {
        return path;
    }


    /**
	 * The method to get the Arraylist of tags
	 * @return the arraylist of strings of the tags
	 */
    public ArrayList<String> getTags() {
        return tags;
    }
    
    /**
     * Removes the given tag out of the tag arraylist
     * @param tag to be removed 
     */
    public void removeTag(String tag) {
        tags.remove(tag);
    }

    /**
     * Gets the caption of the photo
     * @return the caption of the photo 
     */
    public String getCaption() {
        return caption;
    }
    
    /**
     * Sets the caption of the photo to the given caption
     * @param The caption to be set to the photo 
     */
    public void setCaption(String caption) {
        this.caption = caption;
    }

    /**
     * Get the name of the photo 
     * @return the name of the photo 
     */
    public String getName() {
    	return new File(path).getName();
    }
    
    /**
     * Add a tag to the photo
     * @param tag - the tag to be added 
     */
    public void addTag(String tag) {
        tags.add(tag);
    }

    /**
     * Remove a tag to the photo
     * @param tag - the tag to be removed 
     */
    public void deleteTag(String tag) {
        tags.remove(tag);
    }
    
    /**
     * Prints out all the photos in the "local" directory for each user
     */
    public static void getAllPhotos() {
    	if(LoginController.debug==true) {
            System.out.println("\n\n\n");
    	}
        

        // Get the current directory
        String currentDir = System.getProperty("user.dir");
        String storageDir = currentDir + "/src/photos/local";
        File directory = new File(storageDir);

        // Get all the folders in the directory
        File[] folders = directory.listFiles(File::isDirectory);

        // For each folder, get all the files in it and add them to the all-photos arraylist if they are "good"
        for (File folder : folders) {
        	// Initialize the ArrayList of all photos
            Photo.allPhotos = new ArrayList<Photo>();
            File[] files = folder.listFiles();
            for (File file : files) {
                if (file.isFile()) {
                    String fileName = file.getName();
                    if (fileName.toLowerCase().endsWith(".bmp") ||
                            fileName.toLowerCase().endsWith(".gif") ||
                            fileName.toLowerCase().endsWith(".jpeg") ||
                            fileName.toLowerCase().endsWith(".png") ||
                            fileName.toLowerCase().endsWith(".jpg")) {
                        Photo p = new Photo(file.getAbsolutePath());

                        Photo.allPhotos.add(p);
                    } else {
                    	if(LoginController.debug==true) {
                            System.out.println("Unknown file: " + fileName);
                    	}
                    }
                }
            }
            if(LoginController.debug==true) {
                System.out.println("All photos in "+folder.getName()+": " + allPhotos.size());
        	}
            for (Photo p : Photo.allPhotos) {
            	if(LoginController.debug==true) {
                    System.out.println("\t" + new File(p.getName()).getName());
            	}
            }
            if(LoginController.debug==true) {
                System.out.println();
        	}
            // remove extraneous photos
            findOrphan(folder.getName());
        }
    }

    /**
     * Goes into the directory of each user, and finds the photo that is not ownd by the user and remove it.
     * @param username The user name of the user to perform the action on
     */
    public static void findOrphan(String username) {
    	// how about find orphan users???
        // Create a HashSet to store the names of all photos in allPhotos
        HashSet<String> allPhotoNames = new HashSet<>();
        for (Photo photo : allPhotos) {
            allPhotoNames.add(photo.getName());
        }

        // Create a HashSet to store the names of all photos owned by any user
        HashSet<String> ownedPhotoNames = new HashSet<>();
       for(int i=0;i<Privacy.users.size();i++) {
    	   if(Privacy.users.get(i).getUsername().equals(username)) {
    		   for (Album album : Privacy.users.get(i).albums) {
    	            // for each album in the user
    	            for (Photo photo : album.getPhotos()) {
    	                // for each photo in the album
    	                String photoName = photo.getName();
    	                if (!ownedPhotoNames.contains(photoName)) {
    	                    ownedPhotoNames.add(photoName);
    	                }
    	            }
    	        }
    		   break;
    	   }
       }
        
        

        // Find the names of orphan photos by subtracting ownedPhotoNames from allPhotoNames
        HashSet<String> orphanPhotoNames = new HashSet<>(allPhotoNames);
        orphanPhotoNames.removeAll(ownedPhotoNames);

        // Print out the names of orphan photos
        for (String orphanPhotoName : orphanPhotoNames) {
            for (Photo photo : allPhotos) {
                if (photo.getName().equals(orphanPhotoName)) {
                    moveToTrash(photo.getPath());
                    if(LoginController.debug==true) {
                        System.out.println("Orphan Photo " + orphanPhotoName + " moved to trash");
                	}
                    break;
                }
            }
        }
    }

    
    /**
     * Permanently deletes a file
     * @param filePath The path to the files to be deleted 
     */
	 public static boolean deleteFile(String filePath) {
	    File file = new File(filePath);
	    return file.delete();
	 }
	 
	 /**
     * Moves a file to the trash
     * @param filePath The path to the files to be move to trash 
     */
	 public static boolean moveToTrash(String filePath) {
		 Path path = Paths.get(filePath);
		 try {
		    // Try to move to trash (works on macOS and Linux)
		    Files.move(path, Paths.get(System.getProperty("user.home"), ".Trash", path.getFileName().toString()));
		    return true;
		 } catch (Exception e) {
		    // If moving to trash fails, try to move to recycle bin (Windows only)
		    if (System.getProperty("os.name").toLowerCase().contains("win")) {
		    	Path recycleBinPath = Paths.get(System.getProperty("user.home"), "AppData", "Local", "Microsoft", "Windows", "Recycle Bin");
		    	try {
		    		Files.move(path, Paths.get(recycleBinPath.toString(), path.getFileName().toString()));
		    		return true;
		    	} catch (Exception ex) {
			        // If moving to recycle bin fails, delete the file
			        boolean deleteSuccessful = deleteFile(filePath);
			        return deleteSuccessful;
			     }
		    } else {
			      // If not on Windows, delete the file
			      boolean deleteSuccessful = deleteFile(filePath);
			      return deleteSuccessful;
		    }
		 }
	}
 
   
}

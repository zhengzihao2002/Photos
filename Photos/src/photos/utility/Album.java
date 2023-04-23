package photos.utility;

import java.io.Serializable;
import java.util.ArrayList;
/**
This class represents the album of photos.
@author Zihao Zheng, Yiming Huang
@since 04/13/23
*/
public class Album implements Serializable{
    private static final long serialVersionUID = 1L;
    
    /**The name of the current album*/
	private String albumName;
	/**The arraylist of photos the album contains*/
    private ArrayList<Photo> photos;
    
    /**
     * Constructs a new album with the specified name.
     * @param albumName the name of the album
     */
    public Album(String albumName) {
        this.albumName = albumName;
        this.photos = new ArrayList<>();
    }
    
    /**
     * Returns the name of the album.
     * @return the name of the album
     */
    public String getAlbumName() {
        return albumName;
    }

    /**
     * Sets the name of the album.
     * @param albumName the new name of the album
     */
    public void setAlbumName(String albumName) {
        this.albumName = albumName;
    }

    /**
     * Returns an ArrayList of photos in the album.
     * @return an ArrayList of photos in the album
     */
    public ArrayList<Photo> getPhotos() {
        return photos;
    }
    
    /**
     * Adds a photo to the album.
     * @param photo the photo to add to the album
     */
    public void addPhoto(Photo photo) {
        photos.add(photo);
    }
    
    /**
     * Removes a photo from the album.
     * @param photo the photo to remove from the album
     */
    public void removePhoto(Photo photo) {
        photos.remove(photo);
    }
    
    /**
     * Returns the number of photos in the album.
     * @return the number of photos in the album
     */
    public int getNumPhotos() {
        return photos.size();
    }
}
